import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { createCloudNotice, deleteCloudProject, fetchOwnerFile, loadCloudState, loadPublicReview, markCloudNoticeRead, saveCloudProject, submitCloudReview, uploadToWorker } from './lib/cloud'
import { dateLabel, formatSize, loadState, makeProject, saveState } from './lib/demo'
import type { AppState, Project, ProjectFile, ProjectStatus, ReviewComment, User } from './types'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight,
  Clock3, File, FileImage, FileText, Film, FolderKanban, Gauge, Image, Link2, LogOut, Menu,
  MessageCircle, MoreHorizontal, Plus, Search, Settings, ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react'

const statuses: ProjectStatus[] = ['Draft', 'Pending', 'Changes requested', 'Approved']
const statusClass: Record<ProjectStatus, string> = { Draft: 'draft', Pending: 'pending', 'Changes requested': 'changes', Approved: 'approved' }
const initials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = loadState()
    return supabase ? { user: null, projects: [], notices: [] } : saved
  })
  useEffect(() => { if (!supabase) saveState(state) }, [state])
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileNav, setMobileNav] = useState(false)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user
      if (!u || !alive) return
      const user = { id: u.id, email: u.email || '', name: String(u.user_metadata.full_name || u.email || 'Designer') }
      try { const cloud = await loadCloudState(user); if (alive) setState(cloud) }
      catch (error) { if (alive) setToast(error instanceof Error ? error.message : 'Could not load your workspace') }
    })
    return () => { alive = false }
  }, [])
  useEffect(() => { setMobileNav(false) }, [location.pathname])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2800); return () => clearTimeout(id) }, [toast])

  const updateProject = (project: Project) => {
    setState(s => ({ ...s, projects: s.projects.map(p => p.id === project.id ? project : p) }))
    if (supabase && state.user) void saveCloudProject(project, state.user.id).catch(error => setToast(error instanceof Error ? error.message : 'Could not save project'))
  }
  const addProject = (project: Project) => {
    setState(s => ({ ...s, projects: [project, ...s.projects] }))
    if (supabase && state.user) void saveCloudProject(project, state.user.id).catch(error => setToast(error instanceof Error ? error.message : 'Could not save project'))
  }
  const notify = (title: string, detail: string, projectId?: string) => {
    setState(s => ({ ...s, notices: [{ id: crypto.randomUUID(), title, detail, time: 'Just now', read: false, projectId }, ...s.notices] }))
    if (supabase && state.user) void createCloudNotice(state.user.id, title, detail, projectId).catch(error => setToast(error instanceof Error ? error.message : 'Could not save notification'))
  }
  const deleteProject = (id: string) => {
    void (async () => {
      try { if (supabase) await deleteCloudProject(id); setState(s => ({ ...s, projects: s.projects.filter(p => p.id !== id) })); navigate('/projects'); setToast('Project deleted') }
      catch (error) { setToast(error instanceof Error ? error.message : 'Could not delete project') }
    })()
  }
  const login = async (email: string, password: string, name?: string) => {
    if (supabase) {
      const result = name ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } }) : await supabase.auth.signInWithPassword({ email, password })
      if (result.error) throw result.error
      if (name && !result.data.session) throw new Error('Your account was created. Confirm the address in your inbox, then log in. You can disable email confirmation in Supabase for a no-email prototype.')
      const u = result.data.user
      if (u) { const user = { id: u.id, email: u.email ?? email, name: String(u.user_metadata.full_name ?? u.email ?? name ?? 'Designer') }; setState(await loadCloudState(user)) }
    } else {
      const user: User = { id: 'local-' + email.toLowerCase(), email, name: name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
      setState(s => ({ ...s, user }))
    }
  }
  const logout = async () => { if (supabase) await supabase.auth.signOut(); setState(s => ({ ...s, user: null })); navigate('/') }
  const markRead = (id: string) => { setState(s => ({ ...s, notices: s.notices.map(n => ({ ...n, read: n.id === id ? true : n.read })) })); if (supabase) void markCloudNoticeRead(id) }

  const appProps = { state, updateProject, addProject, deleteProject, notify, toast, setToast, logout, search, setSearch, mobileNav, setMobileNav, markRead }
  const isGuest = location.pathname.startsWith('/r/')
  return <>
    <Routes>
      <Route path="/" element={state.user ? <Dashboard {...appProps} /> : <Landing />} />
      <Route path="/login" element={state.user ? <Navigate to="/dashboard" replace /> : <Auth mode="login" onAuth={login} />} />
      <Route path="/signup" element={state.user ? <Navigate to="/dashboard" replace /> : <Auth mode="signup" onAuth={login} />} />
      <Route path="/dashboard" element={state.user ? <Dashboard {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/projects" element={state.user ? <ProjectsPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/projects/new" element={state.user ? <ProjectEditor {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/projects/:id" element={state.user ? <ProjectWorkspace {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/notifications" element={state.user ? <NotificationsPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={state.user ? <SettingsPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/r/:token" element={<ReviewPage state={state} updateProject={updateProject} notify={notify} />} />
      <Route path="*" element={<Navigate to={state.user ? '/dashboard' : '/'} replace />} />
    </Routes>
    {!isGuest && toast && <div className="toast"><Check size={16} />{toast}</div>}
  </>
}

type SharedProps = {
  state: AppState; updateProject: (p: Project) => void; addProject: (p: Project) => void; deleteProject: (id: string) => void;
  notify: (title: string, detail: string, projectId?: string) => void; toast: string; setToast: (s: string) => void; logout: () => void;
  search: string; setSearch: (s: string) => void; mobileNav: boolean; setMobileNav: (b: boolean) => void; markRead: (id: string) => void
}

function Logo({ inverse = false }: { inverse?: boolean }) { return <span className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-mark"><FileText size={19} strokeWidth={2.25} /></span><span>reviewdesk</span></span> }

function Landing() {
  return <main className="landing">
    <header className="landing-nav wrap"><Link to="/" className="plain-link"><Logo /></Link><nav><a href="#how-it-works">How it works</a><a href="#features">Features</a><Link to="/login">Log in</Link><Link to="/signup" className="button button-primary button-small">Get started <ArrowRight size={15} /></Link></nav></header>
    <section className="hero wrap">
      <div className="hero-copy"><div className="hero-tag"><span className="pulse-dot" /> A better way to get to yes</div><h1>Good work deserves<br /><em>a clear green light.</em></h1><p>Share creative work, gather feedback in one place, and get approvals without another endless email thread.</p><div className="hero-actions"><Link to="/signup" className="button button-primary">Start reviewing for free <ArrowRight size={16} /></Link><a href="#how-it-works" className="button button-quiet">See how it works <ChevronRight size={16} /></a></div><div className="hero-proof"><div className="avatar-stack"><span>MO</span><span>DC</span><span>AJ</span><b>+</b></div><div><strong>Made for the work behind the work</strong><small>Designers, editors, and the people who approve.</small></div></div></div>
      <div className="hero-art" aria-label="ReviewDesk feedback preview"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-paper"><div className="paper-bar"><span/><span/><span/><b>summer-campaign-final.jpg</b><MoreHorizontal size={16}/></div><div className="art-image"><div className="art-sun"/><div className="art-slope slope-back"/><div className="art-slope slope-front"/><div className="art-product">NORTH<br/><b>STAR</b></div><div className="art-comment-dot">1</div></div><div className="paper-foot"><span>Version 2 <ChevronDown size={13}/></span><span className="approval-mini"><Check size={12}/> Ready for review</span></div></div><div className="comment-float"><div className="comment-avatar">MO</div><div><strong>Maya Okafor <span>12m ago</span></strong><p>Love where this is going. Could we make the mark a little larger?</p></div><div className="comment-pin">1</div></div><div className="approved-float"><span><CheckCheck size={15}/></span><div><strong>One clear decision</strong><small>Approval saved · 10:42 am</small></div></div><div className="sparkle sparkle-a">✦</div><div className="sparkle sparkle-b">✳</div></div>
    </section>
    <section className="workflow wrap" id="how-it-works"><div className="section-title"><span>From first upload to final yes</span><h2>One calm place for every review.</h2></div><div className="workflow-steps"><Step n="01" title="Create a project" text="Keep each brief, client, and deadline together." icon={<FolderKanban size={19}/>} /><Step n="02" title="Share a review link" text="Send a private link. Reviewers don't need an account." icon={<Link2 size={19}/>} /><Step n="03" title="Get a clear decision" text="Comments, requested changes, and approvals stay with the work." icon={<CheckCheck size={19}/>} /></div></section>
    <section className="feature-band" id="features"><div className="wrap feature-inner"><div><span className="eyebrow">BUILT AROUND YOUR PROCESS</span><h2>Less chasing.<br />More making.</h2><p>ReviewDesk gives creative teams a shared record of what was sent, what changed, and what got approved.</p><Link to="/signup" className="text-link">Create your first project <ArrowRight size={15}/></Link></div><ul><li><span><FileImage size={18}/></span><div><strong>Keep every version together</strong><small>See the latest submission alongside earlier files.</small></div></li><li><span><MessageCircle size={18}/></span><div><strong>Feedback in context</strong><small>Comments and decisions live with the project.</small></div></li><li><span><ShieldCheck size={18}/></span><div><strong>Private by default</strong><small>Drafts stay private. Only shared links can be reviewed.</small></div></li><li><span><Clock3 size={18}/></span><div><strong>Choose how long files stay</strong><small>Set automatic cleanup from 1 to 30 days.</small></div></li></ul></div></section>
    <footer className="wrap landing-footer"><Link to="/" className="plain-link"><Logo /></Link><span>Thoughtful reviews. Better creative work.</span><span>© 2026 ReviewDesk</span></footer>
  </main>
}
function Step({ n, title, text, icon }: { n: string; title: string; text: string; icon: React.ReactNode }) { return <article className="step"><div className="step-head"><span className="step-icon">{icon}</span><span className="step-num">{n}</span></div><h3>{title}</h3><p>{text}</p></article> }

function Auth({ mode, onAuth }: { mode: 'login' | 'signup'; onAuth: (email: string, password: string, name?: string) => Promise<void> }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const navigate = useNavigate(); const signup = mode === 'signup'
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await onAuth(email, password, signup ? name : undefined); navigate('/dashboard') } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in. Check your details and try again.') } finally { setBusy(false) } }
  return <main className="auth-page"><div className="auth-shell"><div className="auth-aside"><Link to="/" className="plain-link"><Logo inverse/></Link><div className="auth-message"><span className="eyebrow">CREATIVE REVIEW, SIMPLIFIED</span><h1>{signup ? <>A little less<br/>back and forth.</> : <>Your next<br/>clear yes.</>}</h1><p>Bring files, feedback, and approvals into one focused workspace.</p><div className="auth-preview"><div className="preview-head"><span className="status-dot"/>Project review <span>·</span> Summer campaign</div><div className="preview-line"><span className="preview-check"><Check size={13}/></span><span><b>Final artwork</b><small>Version 2 · Shared just now</small></span><span className="preview-tag">In review</span></div><div className="preview-line"><span className="preview-comment"><MessageCircle size={14}/></span><span><b>1 new comment</b><small>“Could we make the mark larger?”</small></span></div></div></div><span className="aside-caption">Thoughtful reviews. Better creative work.</span></div><div className="auth-main"><Link to="/" className="mobile-brand plain-link"><Logo/></Link><div className="auth-card"><span className="auth-icon"><Sparkles size={19}/></span><h2>{signup ? 'Create your account' : 'Welcome back'}</h2><p>{signup ? 'Start keeping your creative reviews in one place.' : 'Sign in to pick up where you left off.'}</p><form onSubmit={submit} className="form-stack">{signup && <label>Your name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. David Olowogoke"/></label>}<label>Work email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"/></label><label>Password<input required minLength={6} type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters"/></label>{error && <div className="form-error">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'} <ArrowRight size={15}/></button></form><div className="auth-switch">{signup ? 'Already have an account?' : 'New to ReviewDesk?'} <Link to={signup ? '/login' : '/signup'}>{signup ? 'Log in' : 'Create an account'}</Link></div><div className="auth-note"><ShieldCheck size={14}/> No email or messaging notifications. Your updates stay in ReviewDesk.</div></div><div className="mobile-legal">© 2026 ReviewDesk · Private project reviews</div></div></div></main>
}

function AppShell({ children, title, subtitle, state, search, setSearch, mobileNav, setMobileNav, logout, active = '' }: {
  children: React.ReactNode; title: string; subtitle?: string; state: AppState; search: string; setSearch: (s: string) => void;
  mobileNav: boolean; setMobileNav: (b: boolean) => void; logout: () => void; active?: string
}) {
  const navigate = useNavigate(); const unread = state.notices.filter(n => !n.read).length
  const nav = <><Link to="/dashboard" className={`nav-item ${active === 'dashboard' ? 'active' : ''}`}><Gauge size={17}/>Overview</Link><Link to="/projects" className={`nav-item ${active === 'projects' ? 'active' : ''}`}><FolderKanban size={17}/>Projects <span className="nav-count">{state.projects.length}</span></Link><Link to="/notifications" className={`nav-item ${active === 'notifications' ? 'active' : ''}`}><Bell size={17}/>Notifications{unread > 0 && <span className="nav-unread">{unread}</span>}</Link></>
  return <div className="app-frame"><aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="side-top"><Link to="/dashboard" className="plain-link"><Logo/></Link><button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19}/></button></div><div className="workspace-switch"><span className="workspace-avatar">{initials(state.user?.name || 'RD')}</span><span><b>{state.user?.name || 'My workspace'}</b><small>Personal workspace</small></span><ChevronDown size={15}/></div><div className="nav-label">WORKSPACE</div><nav className="side-nav">{nav}</nav><div className="side-spacer"/><div className="storage-card"><div className="storage-heading"><span>File retention</span><Clock3 size={15}/></div><p>Choose how long project files stay available.</p><div className="retention-track"><span/></div><Link to="/settings">Manage settings <ArrowRight size={13}/></Link></div><nav className="side-nav side-bottom"><Link to="/settings" className={`nav-item ${active === 'settings' ? 'active' : ''}`}><Settings size={17}/>Settings</Link><button className="nav-item" onClick={logout}><LogOut size={17}/>Sign out</button></nav><div className="profile-row"><span className="profile-avatar">{initials(state.user?.name || 'RD')}</span><span><b>{state.user?.name || 'Designer'}</b><small>{state.user?.email}</small></span><MoreHorizontal size={17}/></div></aside>{mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}<main className="app-main"><header className="app-header"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="header-heading"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-tools"><label className="search-box"><Search size={16}/><input placeholder="Search projects" value={search} onChange={e => setSearch(e.target.value)}/><kbd>⌘ K</kbd></label><button className="notification-button" onClick={() => navigate('/notifications')} aria-label="Notifications"><Bell size={18}/>{unread > 0 && <i/>}</button><span className="header-avatar">{initials(state.user?.name || 'RD')}</span></div></header><div className="content-area">{children}</div></main></div>
}

function Dashboard(p: SharedProps) {
  const navigate = useNavigate(); const activeProjects = p.state.projects.filter(x => x.status === 'Pending' || x.status === 'Changes requested')
  const filtered = p.state.projects.filter(x => `${x.title} ${x.client}`.toLowerCase().includes(p.search.toLowerCase())).slice(0, 4)
  return <AppShell title="Overview" subtitle="Here's what's happening with your work." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="dashboard">
    <div className="welcome-row"><div><span className="welcome-date">THURSDAY, OCTOBER 15</span><h2>Good afternoon, {p.state.user?.name.split(' ')[0] || 'there'} <span className="wave">✳</span></h2><p>A little progress adds up. Here's your workspace at a glance.</p></div><button className="button button-primary" onClick={() => navigate('/projects/new')}><Plus size={17}/> New project</button></div>
    <div className="stats-grid"><Stat icon={<FolderKanban size={17}/>} label="Total projects" value={p.state.projects.length} detail="Across your workspace" tone="blue"/><Stat icon={<Clock3 size={17}/>} label="Awaiting review" value={activeProjects.length} detail="With your reviewers" tone="amber"/><Stat icon={<MessageCircle size={17}/>} label="Feedback received" value={p.state.projects.reduce((a, b) => a + b.comments.length, 0)} detail="Across all projects" tone="violet"/><Stat icon={<CheckCheck size={17}/>} label="Approved" value={p.state.projects.filter(x => x.status === 'Approved').length} detail="Ready to deliver" tone="green"/></div>
    <div className="dashboard-grid"><section className="panel project-panel"><div className="panel-head"><div><h3>Recent projects</h3><p>Your latest creative reviews</p></div><Link to="/projects" className="subtle-link">All projects <ArrowRight size={14}/></Link></div>{filtered.length ? <div className="project-list">{filtered.map(project => <ProjectRow key={project.id} project={project} onClick={() => navigate(`/projects/${project.id}`)}/>)}</div> : <EmptyState title="No projects found" text="Try a different search, or start something new." action="Create project" onClick={() => navigate('/projects/new')}/>}<Link to="/projects" className="panel-foot-link">View all projects <ArrowRight size={14}/></Link></section><section className="panel activity-panel"><div className="panel-head"><div><h3>Recent activity</h3><p>Updates from your review links</p></div><Link to="/notifications" className="icon-button panel-icon" aria-label="All activity"><MoreHorizontal size={18}/></Link></div><div className="activity-list">{p.state.notices.slice(0, 4).map((n, i) => <div className="activity-item" key={n.id}><span className={`activity-icon activity-${i % 3}`}>{n.title.toLowerCase().includes('approved') ? <Check size={15}/> : n.title.toLowerCase().includes('comment') ? <MessageCircle size={15}/> : <Bell size={15}/>}</span><span><b>{n.title}</b><small>{n.detail}</small><time>{n.time}</time></span></div>)}{p.state.notices.length === 0 && <div className="activity-empty">Activity will appear here when reviewers respond.</div>}</div><Link to="/notifications" className="panel-foot-link">Open notifications <ArrowRight size={14}/></Link></section></div>
    {!supabase && <div className="demo-callout"><span><Sparkles size={16}/></span><div><b>You're exploring ReviewDesk in demo mode</b><p>Your projects and feedback are saved in this browser. Connect Supabase and R2 to enable secure accounts and original file storage.</p></div><Link to="/settings">Set up services <ArrowRight size={14}/></Link></div>}
  </AppShell>
}
function Stat({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) { return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div> }
function ProjectRow({ project, onClick }: { project: Project; onClick: () => void }) { return <button className="project-row" onClick={onClick}><ProjectGlyph project={project}/><span className="project-row-main"><b>{project.title}</b><small>{project.client} <span>·</span> Updated {dateLabel(project.updatedAt).toLowerCase()}</small></span><StatusPill status={project.status}/><span className="comment-count"><MessageCircle size={14}/>{project.comments.length}</span><ChevronRight size={16} className="row-chevron"/></button> }
function ProjectGlyph({ project }: { project: Project }) { const icon = project.files[0]?.type.startsWith('video') ? <Film size={18}/> : project.files[0]?.type.startsWith('image') ? <Image size={18}/> : <FileText size={18}/>; return <span className={`project-glyph glyph-${project.status === 'Approved' ? 'green' : project.status === 'Changes requested' ? 'amber' : 'blue'}`}>{icon}</span> }
function StatusPill({ status }: { status: ProjectStatus }) { return <span className={`status-pill ${statusClass[status]}`}><i/>{status}</span> }
function EmptyState({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) { return <div className="empty-state"><span><FolderKanban size={20}/></span><b>{title}</b><p>{text}</p>{action && onClick && <button className="button button-outline button-small" onClick={onClick}>{action}</button>}</div> }

function ProjectsPage(p: SharedProps) {
  const navigate = useNavigate(); const [filter, setFilter] = useState<'All' | ProjectStatus>('All')
  const projects = p.state.projects.filter(pr => `${pr.title} ${pr.client}`.toLowerCase().includes(p.search.toLowerCase()) && (filter === 'All' || pr.status === filter))
  return <AppShell title="Projects" subtitle="All of your creative work, in one place." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><div className="page-toolbar"><div className="filter-tabs">{['All', ...statuses].map(s => <button key={s} className={filter === s ? 'selected' : ''} onClick={() => setFilter(s as typeof filter)}>{s}<span>{s === 'All' ? p.state.projects.length : p.state.projects.filter(x => x.status === s).length}</span></button>)}</div><button className="button button-primary" onClick={() => navigate('/projects/new')}><Plus size={16}/> New project</button></div><section className="panel all-projects"><div className="table-head"><span>Project</span><span>Status</span><span>Last updated</span><span>Files</span><span/></div>{projects.map(pr => <ProjectTableRow key={pr.id} project={pr} onClick={() => navigate(`/projects/${pr.id}`)}/>)}{projects.length === 0 && <EmptyState title="Nothing here yet" text="Create a project to share your first file for review." action="Create project" onClick={() => navigate('/projects/new')}/>}</section></AppShell>
}
function ProjectTableRow({ project, onClick }: { project: Project; onClick: () => void }) { return <button className="table-row" onClick={onClick}><span className="table-project"><ProjectGlyph project={project}/><span><b>{project.title}</b><small>{project.client}</small></span></span><StatusPill status={project.status}/><span className="table-date">{dateLabel(project.updatedAt)}</span><span className="file-count"><File size={14}/>{project.files.length}</span><ChevronRight size={16}/></button> }

function ProjectEditor(p: SharedProps) {
  const navigate = useNavigate(); const [title, setTitle] = useState(''); const [client, setClient] = useState(''); const [description, setDescription] = useState(''); const [retention, setRetention] = useState(14); const [files, setFiles] = useState<File[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const save = async (publish: boolean) => {
    if (!title.trim()) return setError('Add a project name to continue.')
    if (publish && files.length === 0) return setError('Add at least one file before sharing for review.')
    setBusy(true); setError('')
    try {
      const project = makeProject(title.trim(), client.trim() || 'Personal project', retention)
      project.description = description.trim()
      if (publish) { project.status = 'Pending'; project.reviewToken = crypto.randomUUID().replaceAll('-', '').slice(0, 24) }
      if (supabase) {
        if (files.length && !import.meta.env.VITE_UPLOAD_WORKER_URL) throw new Error('Connect the Cloudflare upload Worker before adding original files.')
        await saveCloudProject(project, p.state.user!.id)
        for (const file of files) {
          const version = project.files.filter(f => f.name === file.name).length + 1
          const uploaded = await uploadToWorker(project.id, file, version)
          uploaded.url = URL.createObjectURL(file)
          project.files.push(uploaded)
        }
        if (publish) await saveCloudProject(project, p.state.user!.id)
      } else {
        project.files = files.map((file, i) => ({ id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), version: i + 1, url: URL.createObjectURL(file) }))
      }
      p.addProject(project)
      if (publish) p.notify('Project shared for review', project.title, project.id)
      p.setToast(publish ? 'Project shared with reviewers' : 'Draft saved')
      navigate(`/projects/${project.id}`)
    } catch (err) { setError(err instanceof Error ? err.message : 'The project could not be saved.') }
    finally { setBusy(false) }
  }
  return <AppShell title="New project" subtitle="Set up a space for your next review." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><div className="editor-wrap"><button className="back-link" onClick={() => navigate('/projects')}><ArrowLeft size={15}/> Back to projects</button><div className="editor-layout"><section className="panel editor-panel"><div className="editor-title"><span className="editor-icon"><FolderKanban size={19}/></span><div><h2>Project details</h2><p>Give your review a clear name and context.</p></div></div><div className="form-stack editor-form"><label>Project name <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Summer campaign — key visuals"/></label><label>Client or team <input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Northstar Studio"/></label><label>Brief or notes <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add helpful context for your reviewers…"/></label><div className="upload-section"><div className="field-heading"><b>Files for review</b><span>Original quality preserved</span></div><label className="dropzone"><input type="file" multiple accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx" onChange={e => setFiles(fs => [...fs, ...Array.from(e.target.files || [])])}/><span className="upload-cloud"><Upload size={19}/></span><b>Drop files here or <em>browse</em></b><small>Images, video, PDFs and documents</small><small className="size-note">Demo mode keeps file previews for this browser session</small></label>{files.length > 0 && <div className="selected-files">{files.map((f, i) => <div key={`${f.name}-${i}`}><FileText size={16}/><span><b>{f.name}</b><small>{formatSize(f.size)}</small></span><button onClick={() => setFiles(fs => fs.filter((_, n) => n !== i))} aria-label={`Remove ${f.name}`}><X size={15}/></button></div>)}</div>}</div><div className="settings-line"><div><b>Automatic file deletion</b><small>Remove uploaded files after the selected period.</small></div><select value={retention} onChange={e => setRetention(Number(e.target.value))}>{[1,3,7,14,21,30].map(n => <option key={n} value={n}>{n} days</option>)}</select></div><div className="settings-line"><div><b>Allow reviewer downloads</b><small>Reviewers can download the shared files.</small></div><Toggle checked={true} onChange={() => {}}/></div>{error && <div className="form-error">{error}</div>}<div className="editor-actions"><button className="button button-outline" disabled={busy} onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save draft'}</button><button className="button button-primary" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Save and share'} <ArrowRight size={15}/></button></div></div></section><aside className="editor-aside"><div className="aside-note"><span><ShieldCheck size={17}/></span><b>Private until you share</b><p>Draft projects are only visible to you. Reviewers can only access projects through their unique link.</p></div><div className="aside-note"><span><Clock3 size={17}/></span><b>Files have a time limit</b><p>We'll remind you before files are automatically removed.</p></div></aside></div></div></AppShell>
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) { return <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={onChange} aria-pressed={checked}><span/></button> }

function ProjectWorkspace(p: SharedProps) {
  const { id = '' } = useParams(); const navigate = useNavigate(); const project = p.state.projects.find(x => x.id === id); const [showEdit, setShowEdit] = useState(false); const [title, setTitle] = useState(project?.title || ''); const [client, setClient] = useState(project?.client || ''); const [preview, setPreview] = useState<ProjectFile | null>(null)
  if (!project) return <AppShell title="Project not found" state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><EmptyState title="This project isn't here" text="It may have been removed or the link may be incorrect." action="Back to projects" onClick={() => navigate('/projects')}/></AppShell>
  const addFiles = async (list: FileList | null) => {
    if (!list) return
    const selected = Array.from(list)
    try {
      const added: ProjectFile[] = []
      for (const file of selected) {
        const version = project.files.filter(f => f.name === file.name).length + 1
        const item = supabase ? await uploadToWorker(project.id, file, version) : { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), version, url: URL.createObjectURL(file) }
        if (supabase) item.url = URL.createObjectURL(file)
        added.push(item)
      }
      p.updateProject({ ...project, files: [...project.files, ...added], updatedAt: new Date().toISOString() })
      p.setToast(`${added.length} file${added.length === 1 ? '' : 's'} uploaded`)
    } catch (err) { p.setToast(err instanceof Error ? err.message : 'The file upload did not complete.') }
  }
  const openFile = async (file: ProjectFile) => {
    if (supabase && !file.url) {
      try { setPreview({ ...file, url: await fetchOwnerFile(file.id) }) }
      catch (err) { p.setToast(err instanceof Error ? err.message : 'File preview is unavailable.') }
    } else setPreview(file)
  }
  const downloadFile = async (file: ProjectFile) => {
    try { const href = supabase ? await fetchOwnerFile(file.id) : file.url; if (href) { const a = document.createElement('a'); a.href = href; a.download = file.name; a.click(); if (supabase) URL.revokeObjectURL(href) } }
    catch (err) { p.setToast(err instanceof Error ? err.message : 'The download could not start.') }
  }
  const share = () => { const token = project.reviewToken || crypto.randomUUID().replaceAll('-', '').slice(0, 24); p.updateProject({ ...project, reviewToken: token, status: project.files.length ? 'Pending' : 'Draft', updatedAt: new Date().toISOString() }); if (project.files.length) p.notify('Project shared for review', project.title, project.id); p.setToast(project.files.length ? 'Review link is ready' : 'Add a file before sharing'); }
  const saveEdit = () => { p.updateProject({ ...project, title: title.trim() || project.title, client: client.trim() || project.client, updatedAt: new Date().toISOString() }); setShowEdit(false); p.setToast('Project details updated') }
  const link = `${window.location.origin}/r/${project.reviewToken || 'not-shared'}`
  const isImage = (file: ProjectFile) => file.type.startsWith('image/')
  return <AppShell title="Project workspace" subtitle="Files, feedback, and decisions." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><div className="workspace-wrap"><button className="back-link" onClick={() => navigate('/projects')}><ArrowLeft size={15}/> All projects</button><div className="workspace-title-row"><div><div className="crumb"><span>{project.client}</span><ChevronRight size={14}/><span>Project</span></div><h2>{project.title}</h2><div className="workspace-meta"><StatusPill status={project.status}/><span>Updated {dateLabel(project.updatedAt).toLowerCase()}</span>{project.dueDate && <span>Due {new Date(project.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}</div></div><button className="button button-outline" onClick={() => setShowEdit(true)}><MoreHorizontal size={17}/> Manage</button></div>
    <div className="workspace-grid"><div className="workspace-main"><section className="panel files-panel"><div className="panel-head"><div><h3>Files for review <span className="inline-count">{project.files.length}</span></h3><p>Current submission and file history</p></div><label className="button button-outline button-small upload-button"><Plus size={15}/> Add files<input type="file" multiple onChange={e => addFiles(e.target.files)}/></label></div>{project.files.length ? <div className="file-grid">{project.files.map(file => <div className="file-card" key={file.id}><button className="file-preview" onClick={() => void openFile(file)}>{isImage(file) && file.url ? <img src={file.url} alt={file.name}/> : <span className={`file-preview-placeholder ${file.type.startsWith('video') ? 'video-preview' : ''}`}>{file.type.startsWith('video') ? <Film size={31}/> : file.type === 'application/pdf' ? <FileText size={31}/> : <File size={31}/>}<small>{file.name.split('.').pop()?.toUpperCase()}</small></span>}<span className="version-chip">v{file.version}</span></button><div className="file-info"><b title={file.name}>{file.name}</b><small>{formatSize(file.size)} <span>·</span> {dateLabel(file.uploadedAt)}</small></div><button className="download-icon" title="Download" onClick={() => void downloadFile(file)}><ArrowDownToLine size={15}/></button></div>)}</div> : <div className="empty-files"><span><Upload size={20}/></span><b>No files added yet</b><p>Upload creative files to prepare this project for review.</p><label className="button button-outline button-small upload-button"><Plus size={15}/> Add files<input type="file" multiple onChange={e => addFiles(e.target.files)}/></label></div>}</section><section className="panel feedback-panel"><div className="panel-head"><div><h3>Feedback <span className="inline-count">{project.comments.length}</span></h3><p>Comments and decisions from reviewers</p></div></div>{project.comments.length ? <div className="comment-list">{project.comments.map(c => <Comment key={c.id} comment={c}/>)}</div> : <div className="feedback-empty"><MessageCircle size={18}/><span>No feedback yet. Share a review link to invite comments.</span></div>}</section></div><aside className="workspace-side"><section className="panel review-link-panel"><div className="panel-head"><div><h3>Review link</h3><p>Private access for your reviewers</p></div><span className={`link-state ${project.reviewToken ? 'live' : ''}`}>{project.reviewToken ? 'ACTIVE' : 'NOT SHARED'}</span></div>{project.reviewToken ? <><div className="share-url"><Link2 size={15}/><span>{link.replace(window.location.origin, '')}</span><button onClick={() => { navigator.clipboard?.writeText(link); p.setToast('Review link copied') }} aria-label="Copy review link"><FileText size={14}/></button></div><button className="button button-primary button-full" onClick={() => { navigator.clipboard?.writeText(link); p.setToast('Review link copied') }}><Link2 size={15}/> Copy review link</button><Link to={`/r/${project.reviewToken}`} target="_blank" className="open-review-link">Open reviewer view <ArrowRight size={14}/></Link></> : <><div className="link-empty"><span><Link2 size={18}/></span><p>Your reviewer link will appear here after you share the project.</p></div><button className="button button-primary button-full" onClick={share} disabled={!project.files.length}>Share for review <ArrowRight size={15}/></button></>}</section><section className="panel project-info-panel"><h3>Project details</h3><InfoLine label="Client / team" value={project.client}/><InfoLine label="File retention" value={`${project.retentionDays} days`}/><InfoLine label="Downloads" value={project.allowDownload ? 'Allowed' : 'Disabled'}/><button className="settings-inline" onClick={() => setShowEdit(true)}><Settings size={14}/> Edit project details</button></section><section className="retention-warning"><Clock3 size={16}/><p>Files are automatically removed after <b>{project.retentionDays} days</b>. We'll remind you before deletion.</p></section></aside></div></div>
    {showEdit && <Modal title="Manage project" onClose={() => setShowEdit(false)}><div className="form-stack"><label>Project name<input value={title} onChange={e => setTitle(e.target.value)}/></label><label>Client or team<input value={client} onChange={e => setClient(e.target.value)}/></label><div className="settings-line"><div><b>Allow reviewer downloads</b><small>Reviewers can download the shared files.</small></div><Toggle checked={project.allowDownload} onChange={() => p.updateProject({ ...project, allowDownload: !project.allowDownload })}/></div><div className="modal-actions"><button className="button button-outline danger-button" onClick={() => { setShowEdit(false); if (window.confirm('Delete this project and its feedback?')) p.deleteProject(project.id) }}>Delete project</button><button className="button button-primary" onClick={saveEdit}>Save changes</button></div></div></Modal>}
    {preview && <Modal title={preview.name} onClose={() => setPreview(null)} wide><div className="preview-modal-content">{preview.url && preview.type.startsWith('image') ? <img src={preview.url} alt={preview.name}/> : preview.url && preview.type.startsWith('video') ? <video src={preview.url} controls/> : <div className="preview-unavailable"><FileText size={42}/><p>Preview is available when this original file is uploaded to cloud storage.</p></div>}<div className="preview-caption">Version {preview.version} · {formatSize(preview.size)} · Uploaded {new Date(preview.uploadedAt).toLocaleString()}</div></div></Modal>}
  </AppShell>
}
function InfoLine({ label, value }: { label: string; value: string }) { return <div className="info-line"><span>{label}</span><b>{value}</b></div> }
function Comment({ comment }: { comment: ReviewComment }) { return <div className="comment-row"><span className={`comment-avatar-small ${comment.kind}`}>{comment.kind === 'approval' ? <Check size={15}/> : initials(comment.author)}</span><div><div className="comment-author"><b>{comment.author}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></div>{comment.kind !== 'comment' && <span className={`decision-label ${comment.kind}`}>{comment.kind === 'approval' ? 'Approved' : 'Changes requested'}</span>}<p>{comment.body}</p></div></div> }

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) { return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className={`modal ${wide ? 'modal-wide' : ''}`}><div className="modal-heading"><h3>{title}</h3><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>{children}</section></div> }

function ReviewPage({ state, updateProject, notify }: Pick<SharedProps, 'state' | 'updateProject' | 'notify'>) {
  const { token = '' } = useParams(); const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [done, setDone] = useState(''); const [preview, setPreview] = useState<ProjectFile | null>(null); const [cloudProject, setCloudProject] = useState<Project | null>(null); const [cloudLoading, setCloudLoading] = useState(Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    let alive = true
    setCloudLoading(true)
    loadPublicReview(token).then(value => { if (alive) setCloudProject(value) }).catch(err => { if (alive) setDone(err instanceof Error ? err.message : 'This review could not be loaded.') }).finally(() => { if (alive) setCloudLoading(false) })
    return () => { alive = false }
  }, [token])
  const project = supabase ? cloudProject : state.projects.find(p => p.reviewToken === token) || null
  const respond = async (kind: ReviewComment['kind']) => {
    if (!project || !name.trim()) return setDone('Please enter your name so the team knows who responded.')
    if (kind === 'comment' && !message.trim()) return setDone('Write a comment before sending.')
    const body = kind === 'approval' ? 'Approved this submission.' : kind === 'changes' ? message.trim() || 'Please make the requested changes.' : message.trim()
    if (supabase) {
      try {
        await submitCloudReview(token, name.trim(), body, kind)
        setCloudProject(await loadPublicReview(token))
        setDone(kind === 'approval' ? 'Approval recorded. Thank you!' : kind === 'changes' ? 'Your change request has been sent.' : 'Your comment has been added.')
        setMessage('')
      } catch (err) { setDone(err instanceof Error ? err.message : 'Your response could not be sent.') }
      return
    }
    const updated: Project = { ...project, status: kind === 'approval' ? 'Approved' : kind === 'changes' ? 'Changes requested' : project.status, updatedAt: new Date().toISOString(), comments: [...project.comments, { id: crypto.randomUUID(), author: name.trim(), body, createdAt: new Date().toISOString(), kind }] }
    updateProject(updated); notify(kind === 'approval' ? 'Project approved' : kind === 'changes' ? 'Changes requested' : 'New reviewer comment', project.title, project.id); setMessage(''); setDone(kind === 'approval' ? 'Approval recorded. Thank you!' : kind === 'changes' ? 'Your change request has been sent.' : 'Your comment has been added.')
  }
  if (cloudLoading) return <main className="review-page"><div className="review-locked"><Link to="/" className="plain-link"><Logo/></Link><span><ShieldCheck size={24}/></span><h1>Opening review…</h1><p>Loading the latest files and feedback.</p></div></main>
  if (!project || project.status === 'Draft') return <main className="review-page"><div className="review-locked"><Link to="/" className="plain-link"><Logo/></Link><span><ShieldCheck size={24}/></span><h1>This review link isn't available</h1><p>The project is private or this link may have expired. Ask the person who shared it for a current link.</p></div></main>
  return <main className="review-page"><header className="review-header"><Link to="/" className="plain-link"><Logo/></Link><span className="review-header-label"><ShieldCheck size={14}/> Secure review link</span></header><div className="review-content"><div className="review-heading"><span className="eyebrow">PROJECT REVIEW</span><h1>{project.title}</h1><p>{project.client}{project.description ? ` · ${project.description}` : ''}</p><div className="workspace-meta"><StatusPill status={project.status}/><span>Updated {dateLabel(project.updatedAt).toLowerCase()}</span></div></div><div className="review-layout"><section className="review-files"><div className="review-section-head"><div><h2>Files for review</h2><p>{project.files.length} {project.files.length === 1 ? 'file' : 'files'} · Latest version</p></div></div><div className="review-file-list">{project.files.map(f => <div className="review-file-wrap" key={f.id}><button className="review-file-card" onClick={() => setPreview(f)}><span className="review-file-thumb">{f.type.startsWith('image') && f.url ? <img src={f.url} alt=""/> : f.type.startsWith('video') ? <Film size={23}/> : <FileText size={23}/>}</span><span><b>{f.name}</b><small>Version {f.version} · {formatSize(f.size)}</small></span><ChevronRight size={17}/></button>{project.allowDownload && f.url && <a className="review-download" href={f.url.replace('&inline=1', '')} download={f.name}><ArrowDownToLine size={13}/> Download file</a>}</div>)}{!project.files.length && <div className="feedback-empty">No files have been added yet.</div>}</div><div className="review-comments"><h2>Comments and decisions <span>{project.comments.length}</span></h2>{project.comments.map(c => <Comment key={c.id} comment={c}/>)}{!project.comments.length && <p className="no-comments">No comments yet. Add the first note below.</p>}</div></section><aside className="review-response panel"><div className="review-response-heading"><span><MessageCircle size={17}/></span><div><h2>Share your feedback</h2><p>Your name helps the team follow up.</p></div></div><label className="review-name">Your name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Maya Okafor"/></label><label className="review-name">Comment<textarea rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="Share a note or request a change…"/></label>{done && <div className={done.includes('Please') || done.includes('Write') ? 'form-error' : 'success-note'}>{done}</div>}<button className="button button-outline button-full" onClick={() => void respond('comment')}><MessageCircle size={15}/> Add comment</button><button className="button button-outline button-full request-button" disabled={project.status === 'Approved'} onClick={() => void respond('changes')}>Request changes</button><button className="button button-primary button-full" disabled={project.status === 'Approved'} onClick={() => void respond('approval')}><CheckCheck size={15}/>{project.status === 'Approved' ? 'Approved' : 'Approve this work'}</button>{project.allowDownload && <p className="download-permission"><ArrowDownToLine size={14}/> Downloads are allowed for this project.</p>}</aside></div><footer className="review-footer"><span>Powered by <Logo/></span><span>Feedback stays with the project.</span></footer></div>{preview && <Modal title={preview.name} onClose={() => setPreview(null)} wide><div className="preview-modal-content">{preview.url && preview.type.startsWith('image') ? <img src={preview.url} alt={preview.name}/> : preview.url && preview.type.startsWith('video') ? <video src={preview.url} controls/> : <div className="preview-unavailable"><FileText size={42}/><p>File preview isn't available in this demo.</p></div>}</div></Modal>}</main>
}

function NotificationsPage(p: SharedProps) {
  const navigate = useNavigate()
  return <AppShell title="Notifications" subtitle="In-app updates on your reviews and files." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="notifications"><div className="notification-page"><div className="notification-toolbar"><span>{p.state.notices.filter(n => !n.read).length} unread</span><button className="text-link" onClick={() => p.state.notices.forEach(n => p.markRead(n.id))}><CheckCheck size={15}/> Mark all as read</button></div><section className="panel notifications-list">{p.state.notices.map(n => <button key={n.id} className={`notification-row ${n.read ? '' : 'unread'}`} onClick={() => { p.markRead(n.id); if (n.projectId) navigate(`/projects/${n.projectId}`) }}><span className="notification-symbol"><Bell size={17}/></span><span><b>{n.title}</b><small>{n.detail}</small></span><time>{n.time}</time>{!n.read && <i/>}</button>)}{p.state.notices.length === 0 && <EmptyState title="You're all caught up" text="New comments, approvals, and file reminders will show here."/>}</section></div></AppShell>
}
function SettingsPage(p: SharedProps) {
  const [retention, setRetention] = useState('14'); const [saved, setSaved] = useState(false)
  return <AppShell title="Settings" subtitle="Your workspace preferences and services." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="settings"><div className="settings-page"><section className="panel settings-section"><div className="settings-section-title"><span><Clock3 size={18}/></span><div><h3>File retention</h3><p>Choose when project files are automatically deleted.</p></div></div><div className="settings-control"><div><b>Default retention period</b><small>Each project can set its own retention period.</small></div><select value={retention} onChange={e => { setRetention(e.target.value); setSaved(false) }}>{[1,3,7,14,21,30].map(n => <option key={n} value={n}>{n} days</option>)}</select></div><div className="retention-info"><Bell size={15}/><span>ReviewDesk will show an in-app reminder before files are deleted. File deletion runs automatically when Cloudflare Worker services are configured.</span></div><button className="button button-primary button-small" onClick={() => { setSaved(true); p.setToast('Settings saved') }}>{saved ? <><Check size={15}/> Saved</> : 'Save settings'}</button></section><section className="panel settings-section"><div className="settings-section-title"><span><ShieldCheck size={18}/></span><div><h3>Connected services</h3><p>Services that power secure accounts, data, and file storage.</p></div></div><ServiceRow name="Supabase" description="Authentication and project database" ready={Boolean(supabase)}/><ServiceRow name="Cloudflare R2" description="Original quality file storage" ready={Boolean(import.meta.env.VITE_UPLOAD_WORKER_URL)}/><ServiceRow name="Cloudflare Pages" description="App hosting and deployment" ready={false}/><div className="env-tip"><b>Set up your services</b><p>Add the Supabase URL, public anon key, and upload Worker URL to your Cloudflare Pages environment variables. See the README for the database schema and deployment steps.</p><code>VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY · VITE_UPLOAD_WORKER_URL</code></div></section><section className="panel settings-section account-section"><div className="settings-section-title"><span><Settings size={18}/></span><div><h3>Account</h3><p>Signed in as {p.state.user?.email}</p></div></div><button className="button button-outline button-small" onClick={p.logout}><LogOut size={15}/> Sign out</button></section></div></AppShell>
}
function ServiceRow({ name, description, ready }: { name: string; description: string; ready: boolean }) { return <div className="service-row"><span className={`service-mark ${ready ? 'connected' : ''}`}>{ready ? <Check size={15}/> : <span/>}</span><span><b>{name}</b><small>{description}</small></span><span className={`service-status ${ready ? 'connected' : ''}`}>{ready ? 'Connected' : 'Not connected'}</span></div> }
