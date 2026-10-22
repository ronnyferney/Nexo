export const WORKFLOW_QUEUE = 'workflows';
export const JOB_RUN = 'run';
export const JOB_SCHEDULED = 'scheduled';
export const schedulerId = (workflowId: string) => `wf-schedule:${workflowId}`;

export interface RunJobData {
  executionId: string;
}

export interface ScheduledJobData {
  workflowId: string;
}
