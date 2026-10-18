interface Env {
  FILES: R2Bucket
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  CORS_ORIGIN: string
}

type FileRow = { id: string; project_id: string; uploaded_by: string; name: string; content_type: string; byte_size: number; object_key: string; version: number; uploaded_at: string; expires_at: string; reminder_sent_at: string | null }
type ProjectRow = { id: string; owner_id: string; title: string; review_token: string | null; allow_download: boolean; status: string }

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
const cleanName = (name: string) => name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-110) || 'upload'

function cors(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = env.CORS_ORIGIN.split(',').map(x => x.trim()).includes(origin) ? origin : env.CORS_ORIGIN.split(',')[0].trim()
  return { 'access-control-allow-origin': allowed, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '86400', vary: 'Origin' }
}

async function supabaseFetch(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...init.headers },
  })
}

async function authenticatedUser(request: Request, env: Env) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization } })
  if (!response.ok) return null
  const user = await response.json() as { id?: string }
  return user.id ? { id: user.id, authorization } : null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const url = new URL(request.url)
    const uploadMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/files$/i)
    const projectMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)$/i)
    const fileMatch = url.pathname.match(/^\/api\/files\/([0-9a-f-]+)$/i)

    if (request.method === 'DELETE' && projectMatch) {
      const user = await authenticatedUser(request, env)
      if (!user) return json({ error: 'Sign in to delete projects.' }, 401, headers)
      const projectResponse = await supabaseFetch(env, `projects?id=eq.${projectMatch[1]}&owner_id=eq.${user.id}&select=id`)
      const projects = await projectResponse.json() as Array<{ id: string }>
      if (!projectResponse.ok || !projects[0]) return json({ error: 'Project not found.' }, 404, headers)
      const fileResponse = await supabaseFetch(env, `project_files?project_id=eq.${projectMatch[1]}&select=object_key`)
      if (!fileResponse.ok) return json({ error: 'Could not list project files.' }, 500, headers)
      const files = await fileResponse.json() as Array<{ object_key: string }>
      await Promise.all(files.map(file => env.FILES.delete(file.object_key)))
      const deleteResponse = await supabaseFetch(env, `projects?id=eq.${projectMatch[1]}&owner_id=eq.${user.id}`, { method: 'DELETE' })
      if (!deleteResponse.ok) return json({ error: 'Could not delete the project.' }, 500, headers)
      return json({ ok: true }, 200, headers)
    }

    if (request.method === 'POST' && uploadMatch) {
      const user = await authenticatedUser(request, env)
      if (!user) return json({ error: 'Sign in to upload files.' }, 401, headers)
      const projectResponse = await supabaseFetch(env, `projects?id=eq.${uploadMatch[1]}&owner_id=eq.${user.id}&select=id,owner_id,retention_days`)
      const projects = await projectResponse.json() as Array<{ id: string; owner_id: string; retention_days: number }>
      if (!projectResponse.ok || !projects[0]) return json({ error: 'Project not found.' }, 404, headers)
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) return json({ error: 'Choose a file to upload.' }, 400, headers)
      if (file.size === 0 || file.size > 95 * 1024 * 1024) return json({ error: 'Files must be smaller than 95 MB.' }, 413, headers)
      const project = projects[0]
      const objectKey = `${user.id}/${project.id}/${crypto.randomUUID()}-${cleanName(file.name)}`
      const createdAt = new Date()
      const expiresAt = new Date(createdAt.getTime() + project.retention_days * 86400000).toISOString()
      await env.FILES.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' }, customMetadata: { projectId: project.id, ownerId: user.id, originalName: file.name } })
      const insertResponse = await supabaseFetch(env, 'project_files?select=id,project_id,name,content_type,byte_size,version,uploaded_at,expires_at', {
        method: 'POST', headers: { prefer: 'return=representation' },
        body: JSON.stringify({ project_id: project.id, uploaded_by: user.id, name: file.name, content_type: file.type || 'application/octet-stream', byte_size: file.size, object_key: objectKey, version: Number(form.get('version') || 1), uploaded_at: createdAt.toISOString(), expires_at: expiresAt }),
      })
      if (!insertResponse.ok) { await env.FILES.delete(objectKey); return json({ error: 'The file record could not be saved.' }, 500, headers) }
      const saved = await insertResponse.json() as Array<Record<string, unknown>>
      return json({ file: saved[0] }, 201, headers)
    }

    if (request.method === 'GET' && fileMatch) {
      const fileResponse = await supabaseFetch(env, `project_files?id=eq.${fileMatch[1]}&select=id,project_id,uploaded_by,name,content_type,byte_size,object_key,version,uploaded_at,expires_at`)
      const files = await fileResponse.json() as FileRow[]
      const file = files[0]
      if (!file || new Date(file.expires_at).getTime() <= Date.now()) return json({ error: 'This file is no longer available.' }, 404, headers)
      const projectResponse = await supabaseFetch(env, `projects?id=eq.${file.project_id}&select=id,owner_id,review_token,allow_download,status`)
      const projects = await projectResponse.json() as ProjectRow[]
      const project = projects[0]
      if (!project) return json({ error: 'This project is no longer available.' }, 404, headers)
      const reviewerToken = url.searchParams.get('token')
      let authorized = Boolean(project.status !== 'Draft' && reviewerToken && reviewerToken === project.review_token)
      if (!authorized && project.status !== 'Draft' && reviewerToken) {
        const assignmentResponse = await supabaseFetch(env, `review_assignments?project_id=eq.${project.id}&token=eq.${encodeURIComponent(reviewerToken)}&select=id`)
        const assignments = assignmentResponse.ok ? await assignmentResponse.json() as Array<{ id: string }> : []
        authorized = assignments.length > 0
      }
      if (!authorized && request.headers.get('Authorization')) {
        const user = await authenticatedUser(request, env)
        authorized = Boolean(user && user.id === project.owner_id)
        if (!authorized && user && project.status !== 'Draft') {
          const assignmentResponse = await supabaseFetch(env, `review_assignments?project_id=eq.${project.id}&reviewer_id=eq.${user.id}&select=reviewer_id`)
          const assignments = assignmentResponse.ok ? await assignmentResponse.json() as Array<{ reviewer_id: string }> : []
          authorized = assignments.length > 0
        }
      }
      if (!authorized) return json({ error: 'You do not have access to this file.' }, 403, headers)
      const object = await env.FILES.get(file.object_key)
      if (!object) return json({ error: 'File not found in storage.' }, 404, headers)
      const disposition = project.allow_download && url.searchParams.get('inline') !== '1' ? 'attachment' : 'inline'
      return new Response(object.body, { headers: { ...headers, 'content-type': file.content_type, 'content-length': String(file.byte_size), 'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'cache-control': 'private, no-store', etag: object.httpEtag } })
    }
    return json({ error: 'Not found.' }, 404, headers)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupAndRemind(env))
  },
}

async function cleanupAndRemind(env: Env) {
  const now = new Date()
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const expiredResponse = await supabaseFetch(env, `project_files?expires_at=lte.${encodeURIComponent(now.toISOString())}&select=id,project_id,uploaded_by,name,object_key`)
  if (!expiredResponse.ok) throw new Error(`Could not load expired files: ${expiredResponse.status}`)
  const expired = await expiredResponse.json() as Array<Pick<FileRow, 'id' | 'project_id' | 'uploaded_by' | 'name' | 'object_key'>>
  for (const file of expired) {
    await env.FILES.delete(file.object_key)
    const remove = await supabaseFetch(env, `project_files?id=eq.${file.id}`, { method: 'DELETE' })
    if (!remove.ok) throw new Error(`Could not remove expired file record ${file.id}`)
    await supabaseFetch(env, 'notifications', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ owner_id: file.uploaded_by, project_id: file.project_id, title: 'File removed automatically', detail: `${file.name} reached its retention limit.` }) })
  }

  const soonResponse = await supabaseFetch(env, `project_files?expires_at=gt.${encodeURIComponent(now.toISOString())}&expires_at=lte.${encodeURIComponent(soon.toISOString())}&reminder_sent_at=is.null&select=id,project_id,uploaded_by,name`)
  if (!soonResponse.ok) throw new Error(`Could not load files due to expire: ${soonResponse.status}`)
  const soonFiles = await soonResponse.json() as Array<Pick<FileRow, 'id' | 'project_id' | 'uploaded_by' | 'name'>>
  for (const file of soonFiles) {
    await supabaseFetch(env, 'notifications', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ owner_id: file.uploaded_by, project_id: file.project_id, title: 'File expires within 24 hours', detail: `${file.name} will be removed automatically soon.` }) })
    await supabaseFetch(env, `project_files?id=eq.${file.id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ reminder_sent_at: now.toISOString() }) })
  }
}
