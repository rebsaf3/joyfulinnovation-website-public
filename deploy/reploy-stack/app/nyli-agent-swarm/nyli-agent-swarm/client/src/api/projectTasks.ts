export type ProjectTaskRow = {
  id: number;
  description: string;
  assignedAgent: string | null;
  status: string;
  timestamps: Record<string, number>;
  resultPreview: string | null;
  assigneeActivity: {
    lastEvent: string | null;
    lastTs: string | null;
    lastLevel: string | null;
    isWorkingNow: boolean;
    isLikelyWorkingOnTask: boolean;
    isRecentlyActive: boolean;
  } | null;
};

export type ProjectTaskProject = {
  name: string;
  description: string;
  status: string;
  counts: {
    total: number;
    pending: number;
    inProgress: number;
    complete: number;
    failed: number;
  };
  tasks: ProjectTaskRow[];
  historySize: number;
};

export type ProjectTaskPayload = {
  summary: {
    projectCount: number;
    totalTasks: number;
    inProgressTasks: number;
    assignedTasks: number;
  };
  projects: ProjectTaskProject[];
};

export async function fetchProjectTasks(): Promise<ProjectTaskPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch("/api/project-tasks", { signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error("Failed to fetch project tasks");
  return res.json() as Promise<ProjectTaskPayload>;
}
