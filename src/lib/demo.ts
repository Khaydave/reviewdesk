import type { AppState, Colleague, Project, ProjectStatus } from '../types'

const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
const today = new Date()
const people: Array<Colleague & { email: string }> = [
  { userId: 'demo-maya', name: 'Maya Okafor', username: 'maya', email: 'maya@example.com' },
  { userId: 'demo-david', name: 'David Chen', username: 'david', email: 'david@example.com' },
  { userId: 'demo-amara', name: 'Amara James', username: 'amara', email: 'amara@example.com' },
]
const seedProjects: Project[] = [
  { id: 'p1', title: 'Summer campaign — key visuals', client: 'Northstar Studio', description: 'Final campaign artwork for the summer product launch.', status: 'Pending', updatedAt: ago(0), dueDate: new Date(today.getTime() + 2 * 86400000).toISOString(), retentionDays: 14, reviewToken: 'demo-summer-campaign', allowDownload: true, files: [{ id: 'f1', name: 'summer-campaign-final.jpg', size: 2840000, type: 'image/jpeg', uploadedAt: ago(1), version: 2 }], comments: [{ id: 'c1', author: 'Maya Okafor', body: 'The color direction is looking great. Could we make the product mark a little larger?', createdAt: ago(0), kind: 'comment' }], assignments: [{ id: 'a1', reviewerId: 'demo-maya', reviewerName: 'Maya Okafor', username: 'maya', token: 'demo-review-maya', status: 'Pending' }, { id: 'a2', reviewerId: 'demo-david', reviewerName: 'David Chen', username: 'david', token: 'demo-review-david', status: 'Pending' }] },
  { id: 'p2', title: 'Product launch teaser', client: 'Aster & Co.', description: '15 second vertical teaser for social channels.', status: 'Changes requested', updatedAt: ago(1), retentionDays: 7, reviewToken: 'demo-product-teaser', allowDownload: false, files: [{ id: 'f2', name: 'launch-teaser-v1.mp4', size: 18200000, type: 'video/mp4', uploadedAt: ago(2), version: 1 }], comments: [{ id: 'c2', author: 'David Chen', body: 'Please send a version with the updated end card.', createdAt: ago(1), kind: 'changes' }] },
  { id: 'p3', title: 'Brand guidelines refresh', client: 'Good Form', description: 'A lighter, more flexible guide for the new identity.', status: 'Approved', updatedAt: ago(2), retentionDays: 30, allowDownload: true, files: [{ id: 'f3', name: 'good-form-brand-guide.pdf', size: 5240000, type: 'application/pdf', uploadedAt: ago(5), version: 3 }], comments: [{ id: 'c3', author: 'Amara James', body: 'Approved — this gives the team everything they need.', createdAt: ago(2), kind: 'approval' }] },
  { id: 'p4', title: 'Behind the scenes: episode 04', client: 'Field Notes', description: 'Documentary cut for internal review.', status: 'Draft', updatedAt: ago(3), retentionDays: 14, allowDownload: false, files: [], comments: [] },
]
const seed: AppState = {
  user: null,
  projects: seedProjects,
  colleagues: [people[0], people[1]].map(({ email: _email, ...person }) => person),
  notices: [
    { id: 'n1', title: 'Maya left a comment', detail: 'Summer campaign — key visuals', time: '12 min ago', read: false, projectId: 'p1' },
    { id: 'n2', title: 'Changes requested', detail: 'Product launch teaser', time: '1 hour ago', read: false, projectId: 'p2' },
    { id: 'n3', title: 'Your file expires soon', detail: 'launch-teaser-v1.mp4 · 6 days left', time: 'Yesterday', read: true, projectId: 'p2' },
  ],
  sidebarItems: [],
}
const KEY = 'reviewdesk-demo-state-v2'
export function searchDemoPeople(query: string, currentUser?: string): Colleague[] {
  const value = query.trim().replace(/^@/, '').toLowerCase()
  if (value.length < 3) return []
  return people.filter(person => person.userId !== currentUser && (person.username.toLowerCase() === value || person.email.toLowerCase() === value)).map(({ email: _email, ...person }) => person)
}
export function loadState(): AppState {
  try {
    const saved = localStorage.getItem(KEY) || localStorage.getItem('reviewdesk-demo-state-v1')
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<AppState>
      const user = parsed.user ? { ...parsed.user, username: parsed.user.username || parsed.user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]+/g, '_') } : null
      const projects = (parsed.projects || seed.projects).map(project => ({ ...project, assignments: project.assignments || seed.projects.find(sample => sample.id === project.id)?.assignments || [] }))
      return { user, projects, colleagues: parsed.colleagues || seed.colleagues, notices: parsed.notices || seed.notices, sidebarItems: parsed.sidebarItems || [] }
    }
  } catch { /* Reset damaged local demo data. */ }
  return seed
}
export function saveState(state: AppState) { localStorage.setItem(KEY, JSON.stringify(state)) }
export function makeProject(title: string, client: string, retentionDays = 14): Project {
  return { id: crypto.randomUUID(), title, client, description: '', status: 'Draft', updatedAt: new Date().toISOString(), retentionDays, allowDownload: true, files: [], comments: [] }
}
export function withStatus(project: Project, status: ProjectStatus): Project { return { ...project, status, updatedAt: new Date().toISOString() } }
export function dateLabel(date: string) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000))
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${diff} days ago`
}
export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
