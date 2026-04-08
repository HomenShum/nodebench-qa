//! SQLite-backed workflow storage.
//!
//! Stores full workflows as JSON blobs with indexed metadata columns for
//! listing and similarity search without deserializing the event stream.

use crate::types::{Workflow, WorkflowSummary};
use benchpress_core::{Error, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use std::path::Path;
use uuid::Uuid;

/// Persistent storage for captured workflows.
pub struct WorkflowStore {
    conn: Connection,
}

impl WorkflowStore {
    /// Open or create a workflow database at the given path.
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path.as_ref()).map_err(|e| {
            Error::Internal(format!("Failed to open workflow DB: {e}"))
        })?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| Error::Internal(format!("Failed to set pragmas: {e}")))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_model TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                event_count INTEGER NOT NULL,
                fingerprint TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_workflows_fingerprint ON workflows(fingerprint);
            CREATE INDEX IF NOT EXISTS idx_workflows_captured_at ON workflows(captured_at);
            CREATE INDEX IF NOT EXISTS idx_workflows_source_model ON workflows(source_model);",
        )
        .map_err(|e| Error::Internal(format!("Failed to create schema: {e}")))?;

        Ok(Self { conn })
    }

    /// Open an in-memory database (useful for tests).
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().map_err(|e| {
            Error::Internal(format!("Failed to open in-memory DB: {e}"))
        })?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_model TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                event_count INTEGER NOT NULL,
                fingerprint TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_workflows_fingerprint ON workflows(fingerprint);
            CREATE INDEX IF NOT EXISTS idx_workflows_captured_at ON workflows(captured_at);
            CREATE INDEX IF NOT EXISTS idx_workflows_source_model ON workflows(source_model);",
        )
        .map_err(|e| Error::Internal(format!("Failed to create schema: {e}")))?;

        Ok(Self { conn })
    }

    /// Persist a workflow. Replaces if same ID already exists.
    pub fn save_workflow(&self, workflow: &Workflow) -> Result<()> {
        let data = serde_json::to_string(workflow)?;
        let id_str = workflow.id.to_string();
        let captured_at_str = workflow.captured_at.to_rfc3339();
        let event_count = workflow.events.len() as i64;

        self.conn
            .execute(
                "INSERT OR REPLACE INTO workflows (id, name, source_model, captured_at, event_count, fingerprint, data)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id_str,
                    workflow.name,
                    workflow.source_model,
                    captured_at_str,
                    event_count,
                    workflow.fingerprint,
                    data,
                ],
            )
            .map_err(|e| Error::Internal(format!("Failed to save workflow: {e}")))?;

        Ok(())
    }

    /// Load a workflow by ID.
    pub fn get_workflow(&self, id: Uuid) -> Result<Option<Workflow>> {
        let id_str = id.to_string();
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM workflows WHERE id = ?1")
            .map_err(|e| Error::Internal(format!("Failed to prepare query: {e}")))?;

        let result = stmt
            .query_row(params![id_str], |row| {
                let data: String = row.get(0)?;
                Ok(data)
            });

        match result {
            Ok(data) => {
                let workflow: Workflow = serde_json::from_str(&data)?;
                Ok(Some(workflow))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Error::Internal(format!("Failed to get workflow: {e}"))),
        }
    }

    /// List all workflows as lightweight summaries, newest first.
    pub fn list_workflows(&self) -> Result<Vec<WorkflowSummary>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, source_model, event_count, captured_at, fingerprint
                 FROM workflows ORDER BY captured_at DESC",
            )
            .map_err(|e| Error::Internal(format!("Failed to prepare list query: {e}")))?;

        let rows = stmt
            .query_map([], |row| {
                let id_str: String = row.get(0)?;
                let name: String = row.get(1)?;
                let source_model: String = row.get(2)?;
                let event_count: i64 = row.get(3)?;
                let captured_at_str: String = row.get(4)?;
                let fingerprint: String = row.get(5)?;
                Ok((id_str, name, source_model, event_count, captured_at_str, fingerprint))
            })
            .map_err(|e| Error::Internal(format!("Failed to list workflows: {e}")))?;

        let mut summaries = Vec::new();
        for row in rows {
            let (id_str, name, source_model, event_count, captured_at_str, fingerprint) =
                row.map_err(|e| Error::Internal(format!("Row error: {e}")))?;

            let id = Uuid::parse_str(&id_str)
                .map_err(|e| Error::Internal(format!("Invalid UUID: {e}")))?;
            let captured_at: DateTime<Utc> = captured_at_str
                .parse()
                .map_err(|e| Error::Internal(format!("Invalid timestamp: {e}")))?;

            summaries.push(WorkflowSummary {
                id,
                name,
                source_model,
                event_count: event_count as usize,
                captured_at,
                fingerprint,
            });
        }

        Ok(summaries)
    }

    /// Delete a workflow by ID.
    pub fn delete_workflow(&self, id: Uuid) -> Result<()> {
        let id_str = id.to_string();
        let affected = self
            .conn
            .execute("DELETE FROM workflows WHERE id = ?1", params![id_str])
            .map_err(|e| Error::Internal(format!("Failed to delete workflow: {e}")))?;

        if affected == 0 {
            return Err(Error::NotFound(format!("Workflow {id} not found")));
        }

        Ok(())
    }

    /// Find workflows with the same or similar fingerprint.
    /// An exact fingerprint match means identical event streams.
    pub fn find_similar(&self, fingerprint: &str) -> Result<Vec<WorkflowSummary>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, source_model, event_count, captured_at, fingerprint
                 FROM workflows WHERE fingerprint = ?1 ORDER BY captured_at DESC",
            )
            .map_err(|e| Error::Internal(format!("Failed to prepare similarity query: {e}")))?;

        let rows = stmt
            .query_map(params![fingerprint], |row| {
                let id_str: String = row.get(0)?;
                let name: String = row.get(1)?;
                let source_model: String = row.get(2)?;
                let event_count: i64 = row.get(3)?;
                let captured_at_str: String = row.get(4)?;
                let fp: String = row.get(5)?;
                Ok((id_str, name, source_model, event_count, captured_at_str, fp))
            })
            .map_err(|e| Error::Internal(format!("Failed to find similar: {e}")))?;

        let mut summaries = Vec::new();
        for row in rows {
            let (id_str, name, source_model, event_count, captured_at_str, fp) =
                row.map_err(|e| Error::Internal(format!("Row error: {e}")))?;

            let id = Uuid::parse_str(&id_str)
                .map_err(|e| Error::Internal(format!("Invalid UUID: {e}")))?;
            let captured_at: DateTime<Utc> = captured_at_str
                .parse()
                .map_err(|e| Error::Internal(format!("Invalid timestamp: {e}")))?;

            summaries.push(WorkflowSummary {
                id,
                name,
                source_model,
                event_count: event_count as usize,
                captured_at,
                fingerprint: fp,
            });
        }

        Ok(summaries)
    }

    /// Count total stored workflows.
    pub fn count(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM workflows", [], |row| row.get(0))
            .map_err(|e| Error::Internal(format!("Failed to count workflows: {e}")))?;
        Ok(count as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CanonicalEvent, TokenCost, WorkflowMetadata};

    fn make_test_workflow(name: &str) -> Workflow {
        let events = vec![
            CanonicalEvent::Think {
                content: "Let me analyze this".into(),
                duration_ms: 500,
            },
            CanonicalEvent::ToolCall {
                tool: "Bash".into(),
                args: serde_json::json!({"command": "ls"}),
                result: serde_json::json!({"output": "file.rs"}),
                duration_ms: 100,
            },
            CanonicalEvent::FileCreate {
                path: "src/main.rs".into(),
                content: "fn main() {}".into(),
            },
        ];

        Workflow::new(
            name.into(),
            "claude-opus-4-20250514".into(),
            events,
            WorkflowMetadata {
                adapter: "test".into(),
                session_id: Some("sess_123".into()),
                project_path: Some("/tmp/test".into()),
                total_tokens: TokenCost {
                    input_tokens: 1000,
                    output_tokens: 500,
                    total_tokens: 1500,
                    estimated_cost_usd: 0.03,
                },
                duration_ms: 5000,
                task_description: "Test workflow".into(),
            },
        )
    }

    #[test]
    fn roundtrip_save_and_load() {
        let store = WorkflowStore::in_memory().unwrap();
        let wf = make_test_workflow("roundtrip-test");
        let id = wf.id;

        store.save_workflow(&wf).unwrap();
        let loaded = store.get_workflow(id).unwrap().unwrap();

        assert_eq!(loaded.id, id);
        assert_eq!(loaded.name, "roundtrip-test");
        assert_eq!(loaded.events.len(), 3);
        assert_eq!(loaded.fingerprint, wf.fingerprint);
    }

    #[test]
    fn list_and_count() {
        let store = WorkflowStore::in_memory().unwrap();
        store.save_workflow(&make_test_workflow("wf-1")).unwrap();
        store.save_workflow(&make_test_workflow("wf-2")).unwrap();

        assert_eq!(store.count().unwrap(), 2);
        let list = store.list_workflows().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn delete_workflow() {
        let store = WorkflowStore::in_memory().unwrap();
        let wf = make_test_workflow("to-delete");
        let id = wf.id;

        store.save_workflow(&wf).unwrap();
        assert_eq!(store.count().unwrap(), 1);

        store.delete_workflow(id).unwrap();
        assert_eq!(store.count().unwrap(), 0);
        assert!(store.get_workflow(id).unwrap().is_none());
    }

    #[test]
    fn find_similar_by_fingerprint() {
        let store = WorkflowStore::in_memory().unwrap();
        let wf1 = make_test_workflow("wf-a");
        let wf2 = make_test_workflow("wf-b"); // same events -> same fingerprint

        store.save_workflow(&wf1).unwrap();
        store.save_workflow(&wf2).unwrap();

        let similar = store.find_similar(&wf1.fingerprint).unwrap();
        assert_eq!(similar.len(), 2);
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let store = WorkflowStore::in_memory().unwrap();
        let result = store.get_workflow(Uuid::new_v4()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn delete_nonexistent_returns_error() {
        let store = WorkflowStore::in_memory().unwrap();
        let result = store.delete_workflow(Uuid::new_v4());
        assert!(result.is_err());
    }
}
