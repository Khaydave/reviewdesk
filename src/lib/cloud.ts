import { supabase } from './supabase'
import type { AppState, Department, Project, ProjectFile, ProjectStatus, ReviewComment, User, WorkspaceMember } from '../types'

const workerUrl = (import.meta.env.VITE_UPLOAD_WORKER_URL as string | undefined)?.replace(/\/$/, '')
type CloudFile = { id: string; name: string; byte_size: number; content_type: string; uploaded_at: string; version: number }
type CloudComment = { id: string; author_name: string; body: string; created_at: string; kind: ReviewComment['kind'] }
type CloudAssignment = { id: string; reviewer_id: string; reviewer_name: string; username: string; token: string; status: 'Pending' | 'Changes requested' | 'Approved'; responded_at: string | null }
type CloudProject = { id: string; owner_id: string; department_id?: string | null; title: string; client: string; description: string; status: ProjectStatus; updated_at: string; due_date: string | null; retention_days: number; review_token: string | null; allow_download: boolean; project_files?: CloudFile[]; review_comments?: CloudComment[]; review_assignments?: CloudAssignment[] }
type CloudNotice = { id: string; title: string; detail: string; created_at: string; read_at: string | null; project_id: string | null }

const mapFile = (f: CloudFile): ProjectFile => ({ id: f.id, name: f.name, size: Number(f.byte_size), type: f.content_type, uploadedAt: f.uploaded_at, version: f.version })
const mapComment = (c: CloudComment): ReviewComment => ({ id: c.id, author: c.author_name, body: c.body, createdAt: c.created_at, kind: c.kind })
const mapProject = (p: CloudProject): Project => ({ id: p.id, ownerId: p.owner_id, departmentId: p.department_id || undefined, title: p.title, client: p.client, description: p.description, status: p.status, updatedAt: p.updated_at, dueDate: p.due_date || undefined, retentionDays: p.retention_days, reviewToken: p.review_token || undefined, allowDownload: p.allow_download, files: (p.project_files || []).map(mapFile), comments: (p.review_comments || []).map(mapComment), assignments: (p.review_assignments || []).map(a => ({ id: a.id, reviewerId: a.reviewer_id, reviewerName: a.reviewer_name, username: a.username, token: a.token, status: a.status, respondedAt: a.responded_at || undefined })) })

export async function loadCloudState(user: User): Promise<AppState> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const profileResult = await supabase.from('profiles').select('display_name, username, account_type').eq('id', user.id).maybeSingle()
  if (profileResult.error) throw profileResult.error
  const profile = profileResult.data as { display_name?: string; username?: string; account_type?: User['accountType'] } | null
  const currentUser: User = { ...user, name: profile?.display_name || user.name, username: profile?.username || user.username, accountType: profile?.account_type || user.accountType || 'individual' }
  if (currentUser.accountType === 'organization') return loadOrganizationState(currentUser)
  const memberships = await supabase.from('organization_members').select('organization_id, role, created_at, organizations(id, name, invite_token)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1)
  if (memberships.error) throw memberships.error
  const current = memberships.data?.[0] as unknown as { organization_id: string; role: string; organizations: { id: string; name: string; invite_token: string } | null } | undefined
  const organizationId = current?.organization_id
  const [projectsResult, noticesResult, membersResult, departmentsResult] = await Promise.all([
    organizationId ? supabase.from('projects').select('*, project_files(*), review_comments(*), review_assignments(*)').eq('organization_id', organizationId).order('updated_at', { ascending: false }) : supabase.from('projects').select('*, project_files(*), review_comments(*), review_assignments(*)').eq('owner_id', user.id).order('updated_at', { ascending: false }),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
    organizationId ? supabase.from('organization_members').select('user_id, role, department_id, profiles(display_name, username)').eq('organization_id', organizationId) : Promise.resolve({ data: [], error: null }),
    organizationId ? supabase.from('departments').select('id, name').eq('organization_id', organizationId).order('name') : Promise.resolve({ data: [], error: null }),
  ])
  if (projectsResult.error) throw projectsResult.error
  if (noticesResult.error) throw noticesResult.error
  if (membersResult.error) throw membersResult.error
  if (departmentsResult.error) throw departmentsResult.error
  const projects = (projectsResult.data as CloudProject[]).map(mapProject)
  const notices = (noticesResult.data as CloudNotice[]).map(n => ({ id: n.id, title: n.title, detail: n.detail, time: new Date(n.created_at).toLocaleString(), read: Boolean(n.read_at), projectId: n.project_id || undefined }))
  const members: WorkspaceMember[] = (membersResult.data || []).flatMap(raw => {
    const member = raw as unknown as { user_id: string; role: WorkspaceMember['role']; department_id: string | null; profiles: { display_name: string; username: string } | null }
    return member.profiles ? [{ userId: member.user_id, name: member.profiles.display_name || member.profiles.username, username: member.profiles.username, role: member.role, departmentId: member.department_id || undefined }] : []
  })
  const departments = ((departmentsResult.data || []) as Array<{ id: string; name: string }>).map(d => ({ id: d.id, name: d.name }))
  const workspace = current?.organizations ? { id: current.organizations.id, name: current.organizations.name, inviteToken: current.organizations.invite_token } : null
  return { user: currentUser, projects, notices, members, workspace, departments, invites: [] }
}

async function loadOrganizationState(user: User): Promise<AppState> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const orgResult = await supabase.from('organizations').select('id, name, invite_token').eq('created_by', user.id).maybeSingle()
  if (orgResult.error) throw orgResult.error
  if (!orgResult.data) throw new Error('No organisation is connected to this login. Contact support or create an organisation account.')
  const org = orgResult.data as { id: string; name: string; invite_token: string }
  const [projectsResult, membersResult, departmentsResult, invitesResult] = await Promise.all([
    supabase.from('projects').select('*, review_comments(*), review_assignments(*)').eq('organization_id', org.id).order('updated_at', { ascending: false }),
    supabase.from('organization_members').select('user_id, role, department_id, profiles(display_name, username)').eq('organization_id', org.id),
    supabase.from('departments').select('id, name').eq('organization_id', org.id).order('name'),
    supabase.from('organization_invites').select('id, token, department_id, created_at, revoked_at').eq('organization_id', org.id).is('revoked_at', null).order('created_at', { ascending: false }),
  ])
  if (projectsResult.error) throw projectsResult.error
  if (membersResult.error) throw membersResult.error
  if (departmentsResult.error) throw departmentsResult.error
  if (invitesResult.error) throw invitesResult.error
  const members: WorkspaceMember[] = (membersResult.data || []).flatMap(raw => {
    const member = raw as unknown as { user_id: string; role: WorkspaceMember['role']; department_id: string | null; profiles: { display_name: string; username: string } | null }
    return member.profiles ? [{ userId: member.user_id, name: member.profiles.display_name || member.profiles.username, username: member.profiles.username, role: member.role, departmentId: member.department_id || undefined }] : []
  })
  const departments = ((departmentsResult.data || []) as Department[]).map(d => ({ id: d.id, name: d.name }))
  const invites = ((invitesResult.data || []) as Array<{ id: string; token: string; department_id: string | null; created_at: string; revoked_at: string | null }>).map(i => ({ id: i.id, token: i.token, departmentId: i.department_id || undefined, createdAt: i.created_at, revokedAt: i.revoked_at || undefined }))
  return { user, projects: (projectsResult.data as CloudProject[]).map(mapProject), notices: [], members, workspace: { id: org.id, name: org.name, inviteToken: org.invite_token }, departments, invites }
}

export async function saveCloudProject(project: Project, ownerId: string, organizationId?: string) {
  if (!supabase) return
  const { error } = await supabase.from('projects').upsert({
    id: project.id, owner_id: project.ownerId || ownerId, ...(organizationId ? { organization_id: organizationId } : {}), title: project.title, client: project.client, description: project.description,
    department_id: project.departmentId || null, status: project.status, due_date: project.dueDate || null, retention_days: project.retentionDays,
    review_token: project.reviewToken || null, allow_download: project.allowDownload, updated_at: project.updatedAt,
  })
  if (error) throw error
  if (project.assignments) {
    const existingResult = await supabase.from('review_assignments').select('reviewer_id').eq('project_id', project.id)
    if (existingResult.error) throw existingResult.error
    const existingReviewers = new Set((existingResult.data || []).map(row => row.reviewer_id as string))
    const remove = await supabase.from('review_assignments').delete().eq('project_id', project.id)
    if (remove.error) throw remove.error
    if (project.assignments.length) {
      const add = await supabase.from('review_assignments').insert(project.assignments.map(a => ({ id: a.id, project_id: project.id, reviewer_id: a.reviewerId, reviewer_name: a.reviewerName, username: a.username, token: a.token, status: a.status })))
      if (add.error) throw add.error
      const newlyAssigned = project.assignments.filter(a => !existingReviewers.has(a.reviewerId))
      if (newlyAssigned.length) {
        const notifications = await supabase.rpc('notify_reviewers', { p_project_id: project.id, p_reviewer_ids: newlyAssigned.map(a => a.reviewerId), p_title: 'Review assigned to you', p_detail: project.title })
        if (notifications.error) throw notifications.error
      }
    }
  }
}

export async function joinCloudOrganization(inviteToken: string) {
  if (!supabase) throw new Error('Workspace invites are available after connecting Supabase.')
  const { error } = await supabase.rpc('join_organization', { p_invite_token: inviteToken })
  if (error) throw error
}

export async function createCloudDepartment(name: string): Promise<string> {
  if (!supabase) throw new Error('Organisation management is available after connecting Supabase.')
  const { data, error } = await supabase.rpc('create_organization_department', { p_name: name })
  if (error) throw error
  return data as string
}

export async function createCloudOrganizationInvite(departmentId?: string): Promise<{ id: string; token: string }> {
  if (!supabase) throw new Error('Organisation invites are available after connecting Supabase.')
  const { data, error } = await supabase.rpc('create_organization_invite', { p_department_id: departmentId || null })
  if (error) throw error
  const { data: invite, error: lookupError } = await supabase.from('organization_invites').select('id, token').eq('token', data as string).single()
  if (lookupError) throw lookupError
  return invite as { id: string; token: string }
}

export async function revokeCloudOrganizationInvite(inviteId: string) {
  if (!supabase) throw new Error('Organisation invites are available after connecting Supabase.')
  const { error } = await supabase.rpc('revoke_organization_invite', { p_invite_id: inviteId })
  if (error) throw error
}

export async function notifyCloudReviewers(projectId: string, reviewerIds: string[], title: string, detail: string) {
  if (!supabase || reviewerIds.length === 0) return
  const { error } = await supabase.rpc('notify_reviewers', { p_project_id: projectId, p_reviewer_ids: reviewerIds, p_title: title, p_detail: detail })
  if (error) throw error
}

export async function uploadToWorker(projectId: string, file: File, version: number): Promise<ProjectFile> {
  if (!supabase || !workerUrl) throw new Error('Connect the file service before uploading originals.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session expired. Sign in again to upload files.')
  const form = new FormData(); form.set('file', file); form.set('version', String(version))
  const response = await fetch(`${workerUrl}/api/projects/${projectId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: form })
  const body = await response.json() as { file?: { id: string; name: string; content_type: string; byte_size: number; uploaded_at: string; version: number }; error?: string }
  if (!response.ok || !body.file) throw new Error(body.error || 'The file upload did not complete.')
  return mapFile(body.file)
}

export async function fetchOwnerFile(fileId: string): Promise<string> {
  if (!supabase || !workerUrl) throw new Error('File service is not connected.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session expired. Sign in again to view files.')
  const response = await fetch(`${workerUrl}/api/files/${fileId}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  if (!response.ok) throw new Error('This file could not be loaded.')
  return URL.createObjectURL(await response.blob())
}

export async function deleteCloudProject(projectId: string) {
  if (!supabase) return
  if (workerUrl) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const response = await fetch(`${workerUrl}/api/projects/${projectId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || 'Could not delete project files.') }
      return
    }
  }
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw error
}

export async function createCloudNotice(ownerId: string, title: string, detail: string, projectId?: string) {
  if (!supabase) return
  const { error } = await supabase.from('notifications').insert({ owner_id: ownerId, title, detail, project_id: projectId || null })
  if (error) throw error
}

export async function markCloudNoticeRead(id: string) {
  if (!supabase) return
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export type PublicReview = { id: string; title: string; client: string; description: string; status: ProjectStatus; allow_download: boolean; updated_at: string; reviewer_name?: string; assignment_status?: 'Pending' | 'Changes requested' | 'Approved'; review_is_assigned?: boolean; has_assignments?: boolean; files: Array<{ id: string; name: string; content_type: string; byte_size: number; version: number; uploaded_at: string }>; comments: Array<{ id: string; author_name: string; body: string; kind: ReviewComment['kind']; created_at: string }> }
export async function loadPublicReview(token: string): Promise<Project | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('get_public_review', { p_token: token })
  if (error) throw error
  if (!data) return null
  const raw = data as PublicReview
  const files = raw.files.map(f => ({ id: f.id, name: f.name, type: f.content_type, size: Number(f.byte_size), uploadedAt: f.uploaded_at, version: f.version, url: workerUrl ? `${workerUrl}/api/files/${f.id}?token=${encodeURIComponent(token)}&inline=1` : undefined }))
  return { id: raw.id, title: raw.title, client: raw.client, description: raw.description, status: raw.status, updatedAt: raw.updated_at, retentionDays: 14, allowDownload: raw.allow_download, reviewToken: token, reviewerName: raw.reviewer_name, reviewAssignmentStatus: raw.assignment_status, reviewIsAssigned: raw.review_is_assigned, hasReviewAssignments: raw.has_assignments, files, comments: raw.comments.map(c => ({ id: c.id, author: c.author_name, body: c.body, kind: c.kind, createdAt: c.created_at })) }
}

export async function submitCloudReview(token: string, name: string, body: string, action: ReviewComment['kind']) {
  if (!supabase) throw new Error('Review service is unavailable.')
  const { error } = await supabase.rpc('submit_public_review', { p_token: token, p_author_name: name, p_body: body, p_action: action })
  if (error) throw error
}
