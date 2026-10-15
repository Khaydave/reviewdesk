export type ProjectStatus = 'Draft' | 'Pending' | 'Changes requested' | 'Approved'
export type ProjectFile = { id: string; name: string; size: number; type: string; uploadedAt: string; version: number; url?: string }
export type ReviewComment = { id: string; author: string; body: string; createdAt: string; kind: 'comment' | 'changes' | 'approval' }
export type ReviewAssignment = { id: string; reviewerId: string; reviewerName: string; username: string; token: string; status: 'Pending' | 'Changes requested' | 'Approved'; respondedAt?: string }
export type AccountType = 'individual' | 'organization'
export type Department = { id: string; name: string }
export type OrganizationInvite = { id: string; token: string; departmentId?: string; createdAt: string; revokedAt?: string }
export type WorkspaceMember = { userId: string; name: string; username: string; role: 'owner' | 'admin' | 'member'; departmentId?: string }
export type Workspace = { id: string; name: string; inviteToken: string }
export type Project = {
  id: string; title: string; client: string; description: string; status: ProjectStatus; updatedAt: string; ownerId?: string;
  dueDate?: string; retentionDays: number; reviewToken?: string; allowDownload: boolean; departmentId?: string; files: ProjectFile[]; comments: ReviewComment[]; assignments?: ReviewAssignment[]; reviewerName?: string; reviewAssignmentStatus?: ReviewAssignment['status']; reviewIsAssigned?: boolean; hasReviewAssignments?: boolean
}
export type Notice = { id: string; title: string; detail: string; time: string; read: boolean; projectId?: string }
export type User = { id: string; name: string; email: string; username: string; accountType: AccountType }
export type AppState = { user: User | null; projects: Project[]; notices: Notice[]; members: WorkspaceMember[]; workspace: Workspace | null; departments: Department[]; invites: OrganizationInvite[] }
