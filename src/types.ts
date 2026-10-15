export type ProjectStatus = 'Draft' | 'Pending' | 'Changes requested' | 'Approved'
export type ProjectFile = { id: string; name: string; size: number; type: string; uploadedAt: string; version: number; url?: string }
export type ReviewComment = { id: string; author: string; body: string; createdAt: string; kind: 'comment' | 'changes' | 'approval' }
export type Project = {
  id: string; title: string; client: string; description: string; status: ProjectStatus; updatedAt: string;
  dueDate?: string; retentionDays: number; reviewToken?: string; allowDownload: boolean; files: ProjectFile[]; comments: ReviewComment[]
}
export type Notice = { id: string; title: string; detail: string; time: string; read: boolean; projectId?: string }
export type User = { id: string; name: string; email: string }
export type AppState = { user: User | null; projects: Project[]; notices: Notice[] }
