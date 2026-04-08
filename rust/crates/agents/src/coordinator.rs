use benchpress_core::Result;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Agent task classification
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    QaCheck,
    Sitemap,
    UxAudit,
    DiffCrawl,
    WorkflowRecord,
    WorkflowReplay,
    DeviceTest,
    CustomPipeline,
}

/// A task routed by the coordinator to a specialist agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: Uuid,
    pub task_type: TaskType,
    pub url: String,
    pub params: serde_json::Value,
    pub priority: u8,
    pub timeout_ms: u64,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Assigned { agent_id: String },
    Running { progress: f32 },
    Completed { result: serde_json::Value },
    Failed { error: String },
}

/// The coordinator agent: routes tasks and manages agent lifecycle
pub struct Coordinator {
    model: String,
    max_concurrent: usize,
    active_tasks: Vec<AgentTask>,
}

impl Coordinator {
    pub fn new(model: &str, max_concurrent: usize) -> Self {
        Self {
            model: model.to_string(),
            max_concurrent,
            active_tasks: Vec::new(),
        }
    }

    /// Submit a task for routing to the appropriate specialist
    pub async fn submit(&mut self, task: AgentTask) -> Result<Uuid> {
        let id = task.id;

        if self.active_tasks.len() >= self.max_concurrent {
            return Err(benchpress_core::Error::Agent(format!(
                "Max concurrent tasks ({}) reached",
                self.max_concurrent
            )));
        }

        self.active_tasks.push(task);
        Ok(id)
    }

    /// Route a task to the appropriate specialist based on task type
    pub fn route(&self, task: &AgentTask) -> &'static str {
        match task.task_type {
            TaskType::QaCheck | TaskType::UxAudit => "qa-pipeline",
            TaskType::Sitemap | TaskType::DiffCrawl => "crawl-agent",
            TaskType::WorkflowRecord | TaskType::WorkflowReplay => "workflow-agent",
            TaskType::DeviceTest => "device-testing",
            TaskType::CustomPipeline => "custom-pipeline",
        }
    }

    /// Get current task count
    pub fn active_count(&self) -> usize {
        self.active_tasks.len()
    }

    /// Get the model used for coordination
    pub fn model(&self) -> &str {
        &self.model
    }
}
