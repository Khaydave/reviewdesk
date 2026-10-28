import { createContext, FormEvent, useContext, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { addCloudColleague, createCloudNotice, deleteCloudProject, fetchOwnerFile, loadCloudState, loadPublicReview, markCloudNoticeRead, removeCloudColleague, saveCloudProject, saveCloudProfile, searchCloudPeople, submitCloudReview, uploadToWorker, notifyCloudReviewers, recordCloudSidebarOpen, setCloudSidebarPin } from './lib/cloud'
import { dateLabel, formatSize, loadState, makeProject, saveState, searchDemoPeople } from './lib/demo'
import type { AppState, Colleague, Project, ProjectFile, ProjectStatus, ReviewComment, SidebarItem, User } from './types'
import {
  ALargeSmall, ArrowDownToLine, ArrowLeft, ArrowRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight,
  Clock3, File, FileImage, FileText, Film, FolderKanban, Gauge, Image, Link2, LogOut, Menu,
  MessageCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Pin, Search, Settings, ShieldCheck, Sparkles, Upload, X, ZoomIn, ZoomOut, Users, ClipboardList, Copy, Minus, Moon, Sun, UserRound,
} from 'lucide-react'

const statuses: ProjectStatus[] = ['Draft', 'Pending', 'Changes requested', 'Approved']
const statusClass: Record<ProjectStatus, string> = { Draft: 'draft', Pending: 'pending', 'Changes requested': 'changes', Approved: 'approved' }
const initials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
type Theme = 'light' | 'dark'
type UiPreferences = { fontScale: number; setFontScale: (scale: number) => void; sidebarCollapsed: boolean; setSidebarCollapsed: (collapsed: boolean) => void; toggleSidebarPin: (type: SidebarItem['type'], itemId: string, pinned: boolean) => void; theme: Theme; setTheme: (theme: Theme) => void }
const UiPreferencesContext = createContext<UiPreferences | null>(null)
function useUiPreferences() { const preferences = useContext(UiPreferencesContext); if (!preferences) throw new Error('UI preferences are not available'); return preferences }
const readFontScale = () => { const saved = Number(localStorage.getItem('reviewdesk-font-scale')); return Number.isFinite(saved) && saved >= 0.8 && saved <= 1.25 ? saved : 1 }
function DisplaySizeControl({ expanded = false }: { expanded?: boolean }) {
  const [open, setOpen] = useState(false)
  const { fontScale, setFontScale } = useUiPreferences()
  const slider = <div className="display-size-slider"><div className="display-size-labels"><span><Minus size={14}/> Smaller</span><b>{Math.round(fontScale * 100)}%</b><span>Larger <Plus size={14}/></span></div><input aria-label="Text and icon size" type="range" min="0.8" max="1.25" step="0.05" value={fontScale} onChange={event => setFontScale(Number(event.target.value))}/></div>
  return expanded ? <div className="display-size-control display-size-expanded"><div className="display-size-intro"><span className="display-size-icon"><ALargeSmall size={20}/></span><div><b>Text and icon size</b><p>Adjust the interface to suit your preference.</p></div></div>{slider}</div> : <div className="display-size-control display-size-compact"><button type="button" className="display-size-trigger" aria-label="Adjust text and icon size" title="Text and icon size" aria-expanded={open} onClick={() => setOpen(value => !value)}><ALargeSmall size={20}/></button>{open && <div className="display-size-popover">{slider}</div>}</div>
}

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = loadState()
    return supabase ? { user: null, projects: [], notices: [], colleagues: [], sidebarItems: [] } : saved
  })
  useEffect(() => { if (!supabase) saveState(state) }, [state])
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileNav, setMobileNav] = useState(false)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [fontScale, setFontScaleState] = useState(readFontScale)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('reviewdesk-sidebar-collapsed') === 'true')
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('reviewdesk-theme') === 'dark' ? 'dark' : 'light')
  const setFontScale = (scale: number) => setFontScaleState(Math.max(0.8, Math.min(1.25, scale)))
  useEffect(() => {
    const root = document.documentElement
    const applyScale = () => { root.style.setProperty('--rd-root-font-size', `${16 * fontScale}px`); root.style.setProperty('--rd-icon-scale', String(fontScale * (window.innerWidth > 800 ? 1.22 : 1.18))) }
    applyScale()
    window.addEventListener('resize', applyScale)
    localStorage.setItem('reviewdesk-font-scale', String(fontScale))
    return () => window.removeEventListener('resize', applyScale)
  }, [fontScale])
  useEffect(() => { localStorage.setItem('reviewdesk-sidebar-collapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('reviewdesk-theme', theme)
  }, [theme])
  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user
      if (!u || !alive) return
      const user = { id: u.id, email: u.email || '', name: String(u.user_metadata.full_name || u.email || 'Designer'), username: String(u.user_metadata.username || '') }
      try { const cloud = await loadCloudState(user); if (alive) setState(cloud) }
      catch (error) { if (alive) setToast(error instanceof Error ? error.message : 'Could not load your account') }
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
  const login = async (email: string, password: string, name?: string, username?: string) => {
    if (supabase) {
      const normalizedUsername = (username || email.split('@')[0]).trim().toLowerCase()
      const isSignup = name !== undefined
      const result = isSignup
        ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name, username: normalizedUsername } } })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error) throw result.error
      if (isSignup && !result.data.session) throw new Error('Your account was created. Confirm your email, then log in. You can disable email confirmation in Supabase while testing.')
      const u = result.data.user
      if (u) {
        const user: User = { id: u.id, email: u.email ?? email, name: String(u.user_metadata.full_name ?? u.email ?? name ?? 'Designer'), username: String(u.user_metadata.username || normalizedUsername) }
        setState(await loadCloudState(user))
      }
    } else {
      const localUsername = (username || email.split('@')[0]).trim().toLowerCase()
      const user: User = { id: `local-${email.toLowerCase()}`, email, name: name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), username: localUsername }
      setState(s => ({ ...s, user }))
    }
  }
  const logout = async () => { if (supabase) await supabase.auth.signOut(); setState(s => ({ ...s, user: null })); navigate('/') }
  const markRead = (id: string) => { setState(s => ({ ...s, notices: s.notices.map(n => ({ ...n, read: n.id === id ? true : n.read })) })); if (supabase) void markCloudNoticeRead(id) }
  const refreshCloud = async () => { if (supabase && state.user) setState(await loadCloudState(state.user)) }
  const toggleSidebarPin = (type: SidebarItem['type'], itemId: string, pinned: boolean) => {
    const now = new Date().toISOString()
    setState(current => {
      const previous = current.sidebarItems.find(item => item.type === type && item.itemId === itemId)
      const sidebarItems = pinned
        ? [...current.sidebarItems.filter(item => !(item.type === type && item.itemId === itemId)), { type, itemId, pinnedAt: previous?.pinnedAt || now, lastOpenedAt: previous?.lastOpenedAt }]
        : current.sidebarItems.map(item => item.type === type && item.itemId === itemId ? { ...item, pinnedAt: undefined } : item).filter(item => item.pinnedAt || item.lastOpenedAt)
      return { ...current, sidebarItems }
    })
    if (supabase && state.user) void setCloudSidebarPin(state.user.id, type, itemId, pinned).catch(error => setToast(error instanceof Error ? error.message : 'Could not update your pinned items'))
  }
  const openSidebarItem = (type: SidebarItem['type'], itemId: string) => {
    const now = new Date().toISOString()
    setState(current => {
      const previous = current.sidebarItems.find(item => item.type === type && item.itemId === itemId)
      return { ...current, sidebarItems: [...current.sidebarItems.filter(item => !(item.type === type && item.itemId === itemId)), { type, itemId, pinnedAt: previous?.pinnedAt, lastOpenedAt: now }] }
    })
    if (supabase && state.user) void recordCloudSidebarOpen(state.user.id, type, itemId).catch(error => setToast(error instanceof Error ? error.message : 'Could not update recent items'))
  }
  useEffect(() => {
    if (!state.user) return
    const projectMatch = location.pathname.match(/^\/projects\/([^/]+)$/)
    if (projectMatch && state.projects.some(project => project.id === projectMatch[1])) {
      openSidebarItem('project', projectMatch[1])
      return
    }
    const reviewMatch = location.pathname.match(/^\/r\/([^/]+)$/)
    if (reviewMatch) {
      const project = state.projects.find(item => item.assignments?.some(assignment => assignment.token === reviewMatch[1]))
      const assignment = project?.assignments?.find(item => item.token === reviewMatch[1])
      if (assignment && (assignment.reviewerId === state.user.id || assignment.username === state.user.username)) openSidebarItem('review', assignment.id)
    }
  }, [location.pathname, state.user?.id])
  const appProps = { state, setState, updateProject, addProject, deleteProject, notify, toast, setToast, logout, search, setSearch, mobileNav, setMobileNav, markRead, refreshCloud, toggleSidebarPin, openSidebarItem }
  const isGuest = location.pathname.startsWith('/r/')
  return <UiPreferencesContext.Provider value={{ fontScale, setFontScale, sidebarCollapsed, setSidebarCollapsed, toggleSidebarPin, theme, setTheme }}>
    <Routes>
      <Route path="/" element={state.user ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/login" element={state.user ? <Navigate to="/dashboard" replace /> : <Auth mode="login" onAuth={login} />} />
      <Route path="/signup" element={state.user ? <Navigate to="/dashboard" replace /> : <Auth mode="signup" onAuth={login} />} />
      <Route path="/dashboard" element={state.user ? <Dashboard {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/reviews" element={state.user ? <ReviewQueue {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/projects" element={state.user ? <ProjectsPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/projects/new" element={state.user ? <ProjectEditor {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/projects/:id" element={state.user ? <ProjectWorkspace {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/colleagues" element={state.user ? <ColleaguesPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/notifications" element={state.user ? <NotificationsPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/profile" element={state.user ? <ProfilePage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={state.user ? <SettingsPage {...appProps} /> : <Navigate to="/login" replace />} />
      <Route path="/r/:token" element={<ReviewPage state={state} updateProject={updateProject} notify={notify} refreshCloud={refreshCloud} />} />
      <Route path="*" element={<Navigate to={state.user ? '/dashboard' : '/'} replace />} />
    </Routes>
    {!isGuest && toast && <div className="toast"><Check size={16} />{toast}</div>}
  </UiPreferencesContext.Provider>
}

type SharedProps = {
  state: AppState; setState: (s: AppState | ((current: AppState) => AppState)) => void; updateProject: (p: Project) => void; addProject: (p: Project) => void; deleteProject: (id: string) => void;
  notify: (title: string, detail: string, projectId?: string) => void; toast: string; setToast: (s: string) => void; logout: () => void;
  search: string; setSearch: (s: string) => void; mobileNav: boolean; setMobileNav: (b: boolean) => void; markRead: (id: string) => void; refreshCloud: () => Promise<void>;
  toggleSidebarPin: (type: SidebarItem['type'], itemId: string, pinned: boolean) => void; openSidebarItem: (type: SidebarItem['type'], itemId: string) => void
}

function Logo({ inverse = false }: { inverse?: boolean }) { return <span className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-mark"><FileText size={19} strokeWidth={2.25} /></span><span>reviewdesk</span></span> }

function Landing() {
  return <main className="landing">
    <header className="landing-nav wrap"><Link to="/" className="plain-link"><Logo /></Link><nav><a href="#how-it-works">How it works</a><a href="#features">Features</a><DisplaySizeControl/><Link to="/login">Log in</Link><Link to="/signup" className="button button-primary button-small">Get started <ArrowRight size={15} /></Link></nav></header>
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

function Auth({ mode, onAuth }: { mode: 'login' | 'signup'; onAuth: (email: string, password: string, name?: string, username?: string) => Promise<void> }) {
  const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const navigate = useNavigate(); const signup = mode === 'signup'
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      if (signup && !/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3–24 characters using letters, numbers, or underscores.')
      await onAuth(email.trim(), password, signup ? name.trim() : undefined, signup ? username.trim().toLowerCase() : undefined)
      navigate('/dashboard')
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to continue. Check your details and try again.') } finally { setBusy(false) }
  }
  return <main className="auth-page"><div className="auth-shell"><div className="auth-aside"><Link to="/" className="plain-link"><Logo inverse/></Link><div className="auth-message"><span className="eyebrow">CREATIVE REVIEW, SIMPLIFIED</span><h1>{signup ? <>A little less<br/>back and forth.</> : <>Your next<br/>clear yes.</>}</h1><p>Bring files, feedback, and approvals into one focused workspace.</p><div className="auth-preview"><div className="preview-head"><span className="status-dot"/>Project review <span>·</span> Summer campaign</div><div className="preview-line"><span className="preview-check"><Check size={13}/></span><span><b>Final artwork</b><small>Version 2 · Shared just now</small></span><span className="preview-tag">In review</span></div><div className="preview-line"><span className="preview-comment"><MessageCircle size={14}/></span><span><b>1 new comment</b><small>“Could we make the mark larger?”</small></span></div></div></div><span className="aside-caption">Thoughtful reviews. Better creative work.</span></div><div className="auth-main"><Link to="/" className="mobile-brand plain-link"><Logo/></Link><div className="auth-card"><span className="auth-icon"><Sparkles size={19}/></span><h2>{signup ? 'Create your account' : 'Welcome back'}</h2><p>{signup ? 'Create your personal ReviewDesk account.' : 'Sign in to pick up where you left off.'}</p><form onSubmit={submit} className="form-stack">{signup && <label>Your name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. David Olowogoke"/></label>}{signup && <label>Username<input required autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" value={username} onChange={e => setUsername(e.target.value.replace(/\s/g, ''))} placeholder="e.g. david_o"/><small>People can find you by username or email; your email stays private.</small></label>}<label>Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label><label>Password<input required minLength={6} type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters"/></label>{error && <div className="form-error">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'} <ArrowRight size={15}/></button></form><div className="auth-switch">{signup ? 'Already have an account?' : 'New to ReviewDesk?'} <Link to={signup ? '/login' : '/signup'}>{signup ? 'Log in' : 'Create an account'}</Link></div><div className="auth-note"><ShieldCheck size={14}/> Updates stay in ReviewDesk. No email or messaging notifications.</div></div><div className="mobile-legal">© 2026 ReviewDesk · Private project reviews</div></div></div></main>
}

function AppShell({ children, title, subtitle, state, search, setSearch, mobileNav, setMobileNav, logout, active = '' }: {
  children: React.ReactNode; title: string; subtitle?: string; state: AppState; search: string; setSearch: (s: string) => void;
  mobileNav: boolean; setMobileNav: (b: boolean) => void; logout: () => void; active?: string
}) {
  const { sidebarCollapsed, setSidebarCollapsed, toggleSidebarPin } = useUiPreferences()
  const navigate = useNavigate(); const unread = state.notices.filter(n => !n.read).length
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false)
  const [sidebarQuery, setSidebarQuery] = useState('')
  const [pinnedOpen, setPinnedOpen] = useState(true)
  const [recentOpen, setRecentOpen] = useState(true)
  const ownedProjects = state.projects.filter(project => project.ownerId === state.user?.id || !project.ownerId)
  const reviewItems = state.projects.flatMap(project => (project.assignments || [])
    .filter(assignment => assignment.reviewerId === state.user?.id || assignment.username === state.user?.username)
    .map(assignment => ({ type: 'review' as const, itemId: assignment.id, title: project.title, detail: `${project.client} · ${assignment.status}`, href: `/r/${assignment.token}` })))
  const projectItems = ownedProjects.map(project => ({ type: 'project' as const, itemId: project.id, title: project.title, detail: `${project.client} · ${project.status}`, href: `/projects/${project.id}` }))
  const resolveSidebarItem = (item: SidebarItem) => item.type === 'project'
    ? projectItems.find(candidate => candidate.itemId === item.itemId)
    : reviewItems.find(candidate => candidate.itemId === item.itemId)
  type ResolvedSidebarEntry = { item: SidebarItem; target: NonNullable<ReturnType<typeof resolveSidebarItem>> }
  const pinnedItems: ResolvedSidebarEntry[] = state.sidebarItems.filter(item => item.pinnedAt)
    .sort((a, b) => (b.pinnedAt || '').localeCompare(a.pinnedAt || ''))
    .flatMap(item => { const target = resolveSidebarItem(item); return target ? [{ item, target }] : [] })
  const recentItems: ResolvedSidebarEntry[] = state.sidebarItems.filter(item => item.lastOpenedAt && !item.pinnedAt)
    .sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '')).slice(0, 8)
    .flatMap(item => { const target = resolveSidebarItem(item); return target ? [{ item, target }] : [] })
  const searchableItems = [...projectItems, ...reviewItems].filter((item, index, all) => all.findIndex(candidate => candidate.type === item.type && candidate.itemId === item.itemId) === index)
  const sidebarResults = sidebarQuery.trim() ? searchableItems.filter(item => `${item.title} ${item.detail}`.toLowerCase().includes(sidebarQuery.trim().toLowerCase())).slice(0, 8) : []
  const renderSidebarItem = (item: SidebarItem, target: NonNullable<ReturnType<typeof resolveSidebarItem>>) => {
    const pinned = Boolean(item.pinnedAt)
    return <div className="sidebar-work-row" key={`${item.type}:${item.itemId}`}>
      <Link to={target.href} className="sidebar-work-link" title={target.title} onClick={() => setMobileNav(false)}>
        <span className={`sidebar-work-icon ${item.type === 'review' ? 'review' : ''}`}>{item.type === 'review' ? <ClipboardList size={15}/> : <FolderKanban size={15}/>}</span>
        <span className="sidebar-work-copy"><b>{target.title}</b><small>{target.detail}</small></span>
      </Link>
      <button className={`sidebar-pin-button ${pinned ? 'pinned' : ''}`} title={pinned ? 'Unpin item' : 'Pin item'} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${target.title}`} onClick={() => toggleSidebarPin(item.type, item.itemId, !pinned)}><Pin size={14} fill={pinned ? 'currentColor' : 'none'}/></button>
    </div>
  }
  const renderSection = (label: 'PINNED' | 'RECENT', open: boolean, setOpen: (open: boolean) => void, items: ResolvedSidebarEntry[]) => <section className="sidebar-work-section" key={label}>
    <button className="sidebar-section-heading" aria-expanded={open} onClick={() => setOpen(!open)}><span>{label}</span><ChevronDown size={14} className={open ? '' : 'collapsed'}/></button>
    {open && <div className="sidebar-work-list">{items.map(({ item, target }) => renderSidebarItem(item, target))}{!items.length && <p className="sidebar-empty-note">{label === 'PINNED' ? 'Pin a project or review to keep it close.' : 'Projects you open will appear here.'}</p>}</div>}
  </section>
  const myReviews = state.projects.flatMap(project => (project.assignments || []).filter(a => (a.reviewerId === state.user?.id || a.username === state.user?.username) && a.status !== 'Approved'))
  const nav = <><Link title="Overview" to="/dashboard" className={`nav-item ${active === 'dashboard' ? 'active' : ''}`}><Gauge size={19}/><span className="nav-item-label">Overview</span></Link><Link title="Projects" to="/projects" className={`nav-item ${active === 'projects' ? 'active' : ''}`}><FolderKanban size={19}/><span className="nav-item-label">Projects</span><span className="nav-count">{ownedProjects.length}</span></Link><Link title="My reviews" to="/reviews" className={`nav-item ${active === 'reviews' ? 'active' : ''}`}><ClipboardList size={19}/><span className="nav-item-label">My reviews</span>{myReviews.length > 0 && <span className="nav-unread">{myReviews.length}</span>}</Link><Link title="Colleagues" to="/colleagues" className={`nav-item ${active === 'colleagues' ? 'active' : ''}`}><Users size={19}/><span className="nav-item-label">Colleagues</span></Link><Link title="Notifications" to="/notifications" className={`nav-item ${active === 'notifications' ? 'active' : ''}`}><Bell size={19}/><span className="nav-item-label">Notifications</span>{unread > 0 && <span className="nav-unread">{unread}</span>}</Link></>
  return <div className={`app-frame ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <nav className="app-rail" aria-label="Quick navigation">
      <Link to="/dashboard" className="app-rail-brand" title="ReviewDesk" aria-label="ReviewDesk home"><span><FileText size={21}/></span></Link>
      <div className="app-rail-divider"/>
      <Link to="/dashboard" className={`app-rail-link ${active === 'dashboard' ? 'active' : ''}`} title="Overview" aria-label="Overview"><Gauge size={20}/></Link>
      <Link to="/projects" className={`app-rail-link ${active === 'projects' ? 'active' : ''}`} title="Projects" aria-label="Projects"><FolderKanban size={20}/></Link>
      <Link to="/reviews" className={`app-rail-link ${active === 'reviews' ? 'active' : ''}`} title="My reviews" aria-label="My reviews"><ClipboardList size={20}/></Link>
      <Link to="/colleagues" className={`app-rail-link ${active === 'colleagues' ? 'active' : ''}`} title="Colleagues" aria-label="Colleagues"><Users size={20}/></Link>
      <Link to="/notifications" className={`app-rail-link ${active === 'notifications' ? 'active' : ''}`} title="Notifications" aria-label="Notifications"><Bell size={20}/>{unread > 0 && <i/>}</Link>
      <button className="app-rail-create" title="New project" aria-label="New project" onClick={() => navigate('/projects/new')}><Plus size={20}/></button>
    </nav>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
    <div className="side-top"><Link title="ReviewDesk" to="/dashboard" className="plain-link"><Logo/></Link><div className="side-top-actions"><button className="icon-button sidebar-search-button" onClick={() => { if (sidebarCollapsed) setSidebarCollapsed(false); setSidebarSearchOpen(open => !open) }} aria-label="Search your work" aria-expanded={sidebarSearchOpen} title="Search your work"><Search size={19}/></button><button className="icon-button sidebar-collapse-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</button></div><button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19}/></button></div>
    {sidebarSearchOpen && <label className="sidebar-search-field"><Search size={16}/><input autoFocus placeholder="Search projects and reviews" value={sidebarQuery} onChange={event => setSidebarQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSidebarSearchOpen(false); setSidebarQuery('') } }}/><button type="button" className="sidebar-search-close" aria-label="Close search" onClick={() => { setSidebarSearchOpen(false); setSidebarQuery('') }}><X size={15}/></button></label>}
    <Link title="Your profile" to="/profile" className="workspace-switch"><span className="workspace-avatar">{initials(state.user?.name || 'RD')}</span><span><b>{state.user?.name || 'Your account'}</b><small>@{state.user?.username || 'username'}</small></span><ChevronDown size={15}/></Link><div className="nav-label">YOUR WORK</div><nav className="side-nav" onClick={() => setMobileNav(false)}>{nav}</nav>
    <div className="sidebar-work-sections">{sidebarQuery.trim() ? <section className="sidebar-work-section"><div className="sidebar-section-heading static"><span>SEARCH RESULTS</span></div><div className="sidebar-work-list">{sidebarResults.map(target => renderSidebarItem({ type: target.type, itemId: target.itemId, pinnedAt: state.sidebarItems.find(item => item.type === target.type && item.itemId === target.itemId)?.pinnedAt }, target))}{!sidebarResults.length && <p className="sidebar-empty-note">No matching projects or reviews.</p>}</div></section> : <>{renderSection('PINNED', pinnedOpen, setPinnedOpen, pinnedItems)}{renderSection('RECENT', recentOpen, setRecentOpen, recentItems)}</>}</div>
    <div className="side-spacer"/><nav className="side-nav side-bottom" onClick={() => setMobileNav(false)}><Link title="Profile" to="/profile" className={`nav-item ${active === 'profile' ? 'active' : ''}`}><UserRound size={19}/><span className="nav-item-label">Profile</span></Link><Link title="Settings" to="/settings" className={`nav-item ${active === 'settings' ? 'active' : ''}`}><Settings size={19}/><span className="nav-item-label">Settings</span></Link><button title="Sign out" className="nav-item" onClick={logout}><LogOut size={19}/><span className="nav-item-label">Sign out</span></button></nav>
  </aside>{mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}<main className="app-main"><header className="app-header"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu" aria-expanded={mobileNav}><Menu size={20}/></button><div className="header-heading"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-tools"><label className="search-box"><Search size={16}/><input placeholder="Search projects" value={search} onChange={e => setSearch(e.target.value)}/><kbd>⌘ K</kbd></label><button className="notification-button" onClick={() => navigate('/notifications')} aria-label="Notifications"><Bell size={18}/>{unread > 0 && <i/>}</button><Link to="/profile" className="header-avatar" aria-label="Your profile">{initials(state.user?.name || 'RD')}</Link></div></header><div className="content-area">{children}</div></main></div>
}
function Dashboard(p: SharedProps) {
  const navigate = useNavigate()
  const ownProjects = p.state.projects.filter(project => project.ownerId === p.state.user?.id || !project.ownerId)
  const assignedReviews = p.state.projects.flatMap(project => (project.assignments || []).filter(a => (a.reviewerId === p.state.user?.id || a.username === p.state.user?.username) && a.status === 'Pending').map(assignment => ({ project, assignment })))
  const filtered = ownProjects.filter(x => `${x.title} ${x.client}`.toLowerCase().includes(p.search.toLowerCase())).slice(0, 4)
  return <AppShell title="Overview" subtitle="Here's what's happening with your work." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="dashboard">
    <div className="welcome-row"><div><span className="welcome-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</span><h2>Good afternoon, {p.state.user?.name.split(' ')[0] || 'there'} <span className="wave">✳</span></h2><p>A little progress adds up. Here is your review desk at a glance.</p></div><button className="button button-primary" onClick={() => navigate('/projects/new')}><Plus size={17}/> New project</button></div>
    <div className="stats-grid redesigned-stats">
      <Stat icon={<FolderKanban size={18}/>} label="Projects" value={ownProjects.length} detail="Created by you" tone="blue"/>
      <Stat icon={<ClipboardList size={18}/>} label="Pending reviews" value={assignedReviews.length} detail="Waiting for your response" tone="amber"/>
      <Stat icon={<MessageCircle size={18}/>} label="Feedback" value={ownProjects.reduce((a, b) => a + b.comments.length, 0)} detail="Across your projects" tone="violet"/>
      <Stat icon={<CheckCheck size={18}/>} label="Approved" value={ownProjects.filter(x => x.status === 'Approved').length} detail="Ready to deliver" tone="green"/>
    </div>
    <section className="panel review-queue-panel">
      <div className="panel-head"><div><h3>Pending reviews</h3><p>Work waiting for your response</p></div><Link to="/reviews" className="subtle-link">View all <ArrowRight size={14}/></Link></div>
      <div className="assigned-list">{assignedReviews.slice(0, 4).map(({project, assignment}) => {
        const pinned = p.state.sidebarItems.some(item => item.type === 'review' && item.itemId === assignment.id && item.pinnedAt)
        return <div className="assigned-row-wrap" key={assignment.id}><Link to={`/r/${assignment.token}`} target="_blank" className="assigned-row" onClick={() => p.openSidebarItem('review', assignment.id)}><span className="assigned-glyph"><ClipboardList size={18}/></span><span className="assigned-main"><b>{project.title}</b><small>{project.client} · Requested recently</small></span><StatusPill status={assignment.status}/><ArrowRight size={15}/></Link><button className={`dashboard-pin-button ${pinned ? 'pinned' : ''}`} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${project.title} review`} title={pinned ? 'Unpin review' : 'Pin review'} onClick={() => p.toggleSidebarPin('review', assignment.id, !pinned)}><Pin size={16} fill={pinned ? 'currentColor' : 'none'}/></button></div>
      })}{assignedReviews.length === 0 && <div className="review-queue-empty"><span className="review-queue-check"><Check size={16}/></span><div><b>You’re all caught up</b><p>Assigned reviews will show here when someone needs your feedback.</p></div></div>}</div>
    </section>
    <div className="dashboard-grid"><section className="panel project-panel"><div className="panel-head"><div><h3>Recent projects</h3><p>Your latest creative reviews</p></div><Link to="/projects" className="subtle-link">All projects <ArrowRight size={14}/></Link></div>{filtered.length ? <div className="project-list">{filtered.map(project => <ProjectRow key={project.id} project={project} pinned={p.state.sidebarItems.some(item => item.type === 'project' && item.itemId === project.id && item.pinnedAt)} onTogglePin={pinned => p.toggleSidebarPin('project', project.id, pinned)} onClick={() => navigate(`/projects/${project.id}`)}/>)}</div> : <EmptyState title="No projects found" text="Try a different search, or start something new." action="Create project" onClick={() => navigate('/projects/new')}/>}<Link to="/projects" className="panel-foot-link">View all projects <ArrowRight size={14}/></Link></section><section className="panel activity-panel"><div className="panel-head"><div><h3>Recent activity</h3><p>Updates from your review links</p></div><Link to="/notifications" className="icon-button panel-icon" aria-label="All activity"><MoreHorizontal size={18}/></Link></div><div className="activity-list">{p.state.notices.slice(0, 4).map((n, i) => <div className="activity-item" key={n.id}><span className={`activity-icon activity-${i % 3}`}>{n.title.toLowerCase().includes('approved') ? <Check size={15}/> : n.title.toLowerCase().includes('comment') ? <MessageCircle size={15}/> : <Bell size={15}/>}</span><span><b>{n.title}</b><small>{n.detail}</small><time>{n.time}</time></span></div>)}{p.state.notices.length === 0 && <div className="activity-empty">Activity will appear here when reviewers respond.</div>}</div><Link to="/notifications" className="panel-foot-link">Open notifications <ArrowRight size={14}/></Link></section></div>
    {!supabase && <div className="demo-callout"><span><Sparkles size={16}/></span><div><b>You're exploring ReviewDesk in demo mode</b><p>Your projects and feedback are saved in this browser. Connect Supabase and R2 to enable secure accounts and original file storage.</p></div><Link to="/settings">Set up services <ArrowRight size={14}/></Link></div>}
  </AppShell>
}

function Stat({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) { return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div> }
function ReviewQueue(p: SharedProps) {
  const mine = p.state.projects.flatMap(project => (project.assignments || []).filter(a => (a.reviewerId === p.state.user?.id || a.username === p.state.user?.username) && a.status !== 'Approved').map(assignment => ({ project, assignment })))
  return <AppShell title="My reviews" subtitle="Projects people have assigned to you." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="reviews"><section className="panel assigned-panel"><div className="panel-head"><div><h3>{mine.length} pending {mine.length === 1 ? 'review' : 'reviews'}</h3><p>Open each private link directly. You can review without signing in again.</p></div></div><div className="assigned-list">{mine.map(({project, assignment}) => <Link to={`/r/${assignment.token}`} target="_blank" className="assigned-row" key={assignment.id}><span className="assigned-glyph"><ClipboardList size={17}/></span><span className="assigned-main"><b>{project.title}</b><small>{project.client} · Shared with @{assignment.username}</small></span><StatusPill status={assignment.status}/><ArrowRight size={15}/></Link>)}{mine.length === 0 && <EmptyState title="You're all caught up" text="Projects assigned by teammates will appear here. Open their direct review link to respond without signing in."/>}</div></section></AppShell>
}
function ColleaguesPage(p: SharedProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Colleague[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (query.trim().length < 3) { setResults([]); setError(''); return }
    let active = true
    const timer = window.setTimeout(async () => {
      setBusy(true); setError('')
      try {
        const people = supabase ? await searchCloudPeople(query) : searchDemoPeople(query, p.state.user?.id)
        if (active) setResults(people)
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Search could not be completed.') }
      finally { if (active) setBusy(false) }
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, p.state.user?.id])
  const saveColleague = async (person: Colleague) => {
    try {
      if (supabase) await addCloudColleague(person.userId)
      p.setState(state => state.colleagues.some(item => item.userId === person.userId) ? state : { ...state, colleagues: [person, ...state.colleagues] })
      p.setToast(`${person.name} added to colleagues`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add colleague.') }
  }
  const removeColleague = async (person: Colleague) => {
    try {
      if (supabase) await removeCloudColleague(person.userId)
      p.setState(state => ({ ...state, colleagues: state.colleagues.filter(item => item.userId !== person.userId) }))
      p.setToast(`${person.name} removed from colleagues`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove colleague.') }
  }
  const saved = (id: string) => p.state.colleagues.some(person => person.userId === id)
  return <AppShell title="Colleagues" subtitle="Save people you often invite to review your work." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="colleagues"><div className="colleague-page"><section className="panel colleague-search-panel"><div className="panel-head"><div><h3>Find someone on ReviewDesk</h3><p>Search by their unique username or exact email address.</p></div><span className="org-dept-icon"><Users size={19}/></span></div><form className="colleague-search-form" onSubmit={event => event.preventDefault()}><label className="member-search"><span>Username or email</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. @maya or maya@example.com" autoComplete="off"/></label><div className="colleague-search-hint"><ShieldCheck size={15}/> Email addresses are only used to find accounts and are never shown to other people.</div></form>{error && <div className="form-error">{error}</div>}{query.trim().length >= 3 && <div className="member-pick-list">{busy ? <div className="member-empty">Searching ReviewDesk…</div> : results.map(person => <div className="member-pick" key={person.userId}><span className="member-avatar">{initials(person.name)}</span><span className="member-pick-details"><b>{person.name}</b><small>@{person.username}</small></span>{saved(person.userId) ? <button className="member-pick-action selected" onClick={() => void removeColleague(person)}><Check size={15}/> Remove</button> : <button className="member-pick-action" onClick={() => void saveColleague(person)}><Plus size={15}/> Add colleague</button>}</div>)}{!busy && !results.length && <div className="member-empty">No account found. Check the username or exact email address and try again.</div>}</div>}</section><section className="panel colleague-saved-panel"><div className="panel-head"><div><h3>Saved colleagues</h3><p>Quickly add these people when you create a project.</p></div><span className="org-count-badge">{p.state.colleagues.length}</span></div>{p.state.colleagues.length ? <div className="member-pick-list">{p.state.colleagues.map(person => <div className="member-pick" key={person.userId}><span className="member-avatar">{initials(person.name)}</span><span className="member-pick-details"><b>{person.name}</b><small>@{person.username}</small></span><button className="org-revoke-invite" aria-label={`Remove ${person.name} from colleagues`} title="Remove colleague" onClick={() => void removeColleague(person)}><X size={18}/></button></div>)}</div> : <EmptyState title="No colleagues saved yet" text="Search by username or email and add people you work with often."/>}{!supabase && <div className="demo-team-note">Demo search includes a few sample ReviewDesk accounts. Connect Supabase to find registered users.</div>}</section></div></AppShell>
}

function ProjectRow({ project, pinned, onTogglePin, onClick }: { project: Project; pinned: boolean; onTogglePin: (pinned: boolean) => void; onClick: () => void }) { return <div className="project-row-wrap"><button className="project-row" onClick={onClick}><ProjectGlyph project={project}/><span className="project-row-main"><b>{project.title}</b><small>{project.client} <span>·</span> Updated {dateLabel(project.updatedAt).toLowerCase()}</small></span><StatusPill status={project.status}/><span className="comment-count"><MessageCircle size={14}/>{project.comments.length}</span><ChevronRight size={16} className="row-chevron"/></button><button className={`dashboard-pin-button ${pinned ? 'pinned' : ''}`} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${project.title}`} title={pinned ? 'Unpin project' : 'Pin project'} onClick={() => onTogglePin(!pinned)}><Pin size={16} fill={pinned ? 'currentColor' : 'none'}/></button></div> }
function ProjectGlyph({ project }: { project: Project }) { const icon = project.files[0]?.type.startsWith('video') ? <Film size={18}/> : project.files[0]?.type.startsWith('image') ? <Image size={18}/> : <FileText size={18}/>; return <span className={`project-glyph glyph-${project.status === 'Approved' ? 'green' : project.status === 'Changes requested' ? 'amber' : 'blue'}`}>{icon}</span> }
function StatusPill({ status }: { status: ProjectStatus }) { return <span className={`status-pill ${statusClass[status]}`}><i/>{status}</span> }
function EmptyState({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) { return <div className="empty-state"><span><FolderKanban size={20}/></span><b>{title}</b><p>{text}</p>{action && onClick && <button className="button button-outline button-small" onClick={onClick}>{action}</button>}</div> }

function ProjectsPage(p: SharedProps) {
  const navigate = useNavigate(); const [filter, setFilter] = useState<'All' | ProjectStatus>('All')
  const ownProjects = p.state.projects.filter(pr => pr.ownerId === p.state.user?.id || !pr.ownerId)
  const projects = ownProjects.filter(pr => `${pr.title} ${pr.client}`.toLowerCase().includes(p.search.toLowerCase()) && (filter === 'All' || pr.status === filter))
  return <AppShell title="Projects" subtitle="Your creative work, in one place." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><div className="page-toolbar"><div className="filter-tabs">{['All', ...statuses].map(s => <button key={s} className={filter === s ? 'selected' : ''} onClick={() => setFilter(s as typeof filter)}>{s}<span>{s === 'All' ? ownProjects.length : ownProjects.filter(x => x.status === s).length}</span></button>)}</div><button className="button button-primary" onClick={() => navigate('/projects/new')}><Plus size={16}/> New project</button></div><section className="panel all-projects"><div className="table-head"><span>Project</span><span>Status</span><span>Last updated</span><span>Files</span><span/></div>{projects.map(pr => <ProjectTableRow key={pr.id} project={pr} onClick={() => navigate(`/projects/${pr.id}`)}/>)}{projects.length === 0 && <EmptyState title="Nothing here yet" text="Create a project to share your first file for review." action="Create project" onClick={() => navigate('/projects/new')}/>}</section></AppShell>
}
function ProjectTableRow({ project, onClick }: { project: Project; onClick: () => void }) { return <button className="table-row" onClick={onClick}><span className="table-project"><ProjectGlyph project={project}/><span><b>{project.title}</b><small>{project.client}</small></span></span><StatusPill status={project.status}/><span className="table-date">{dateLabel(project.updatedAt)}</span><span className="file-count"><File size={14}/>{project.files.length}</span><ChevronRight size={16}/></button> }

function ProjectEditor(p: SharedProps) {
  const navigate = useNavigate(); const [title, setTitle] = useState(''); const [client, setClient] = useState(''); const [description, setDescription] = useState(''); const [retention, setRetention] = useState(14); const [files, setFiles] = useState<File[]>([]); const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]); const [reviewerSearch, setReviewerSearch] = useState(''); const [reviewerResults, setReviewerResults] = useState<Colleague[]>(p.state.colleagues); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => {
    const query = reviewerSearch.trim()
    if (query.length < 3) { setReviewerResults(p.state.colleagues); return }
    let active = true
    const timer = window.setTimeout(() => {
      const search = supabase ? searchCloudPeople(query) : Promise.resolve(searchDemoPeople(query, p.state.user?.id))
      search.then(results => { if (active) setReviewerResults(results) }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not find that account.') })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [reviewerSearch, p.state.colleagues, p.state.user?.id])
  const reviewerCandidates = [...p.state.colleagues, ...reviewerResults].filter((person, index, list) => list.findIndex(candidate => candidate.userId === person.userId) === index)
  const save = async (publish: boolean) => {
    if (!title.trim()) return setError('Add a project name to continue.')
    if (publish && files.length === 0) return setError('Add at least one file before sharing for review.')
    setBusy(true); setError('')
    try {
      const project = makeProject(title.trim(), client.trim() || 'Personal project', retention)
      project.description = description.trim()
      project.ownerId = p.state.user?.id
      if (publish) {
        project.status = 'Pending'; project.reviewToken = crypto.randomUUID().replaceAll('-', '').slice(0, 32)
        project.assignments = reviewerCandidates.filter(person => selectedReviewers.includes(person.userId)).map(person => ({ id: crypto.randomUUID(), reviewerId: person.userId, reviewerName: person.name, username: person.username, token: crypto.randomUUID().replaceAll('-', '').slice(0, 48), status: 'Pending' as const }))
      }
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
  return <AppShell title="New project" subtitle="Set up a space for your next review." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><div className="editor-wrap"><button className="back-link" onClick={() => navigate('/projects')}><ArrowLeft size={15}/> Back to projects</button><div className="editor-layout"><section className="panel editor-panel"><div className="editor-title"><span className="editor-icon"><FolderKanban size={19}/></span><div><h2>Project details</h2><p>Give your review a clear name and context.</p></div></div><div className="form-stack editor-form"><label>Project name <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Summer campaign — key visuals"/></label><label>Client or team <input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Northstar Studio"/></label><label>Brief or notes <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add helpful context for your reviewers…"/></label><div className="reviewer-picker"><div className="field-heading"><b>Assign reviewers</b><span>Look up a username or exact email</span></div><label className="member-search">Find a ReviewDesk account<input value={reviewerSearch} onChange={e => setReviewerSearch(e.target.value)} placeholder="e.g. @maya or maya@example.com"/></label>{reviewerSearch.trim().length < 3 && p.state.colleagues.length > 0 && <p className="display-size-note">Your saved colleagues are shown below. Search to find someone new.</p>}{reviewerResults.length ? <div className="member-pick-list">{reviewerResults.map(person => { const selected = selectedReviewers.includes(person.userId); return <div className={`member-pick ${selected ? 'selected' : ''}`} key={person.userId}><span className="member-avatar">{initials(person.name)}</span><span className="member-pick-details"><b>{person.name}</b><small>@{person.username}</small></span><button type="button" className={`member-pick-action ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={async () => { setSelectedReviewers(list => selected ? list.filter(id => id !== person.userId) : [...list, person.userId]); if (!selected && !p.state.colleagues.some(c => c.userId === person.userId)) { try { if (supabase) await addCloudColleague(person.userId); p.setState(current => ({ ...current, colleagues: [...current.colleagues, person] })) } catch (err) { p.setToast(err instanceof Error ? err.message : 'Could not save colleague') } } }}>{selected ? <><Check size={15}/> Remove</> : <><Plus size={15}/> Add</>}</button></div>})}</div> : <div className="member-empty">{reviewerSearch.trim().length < 3 ? 'No saved colleagues yet. Search by username or exact email to find someone.' : 'No account found. Check the username or email and try again.'}</div>}{selectedReviewers.length > 0 && <div className="display-size-note">{selectedReviewers.length} reviewer{selectedReviewers.length === 1 ? '' : 's'} selected</div>}</div><div className="upload-section"><div className="field-heading"><b>Files for review</b><span>Original quality preserved</span></div><label className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFiles(fs => [...fs, ...Array.from(e.dataTransfer.files)]) }}><input type="file" multiple accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx" onChange={e => setFiles(fs => [...fs, ...Array.from(e.target.files || [])])}/><span className="upload-cloud"><Upload size={19}/></span><b>Drop files here or <em>browse</em></b><small>Images, video, PDFs and documents</small><small className="size-note">{supabase ? 'Original files upload privately to Cloudflare R2' : 'Demo mode keeps file previews for this browser session'}</small></label>{files.length > 0 && <div className="selected-files">{files.map((f, i) => <div key={`${f.name}-${i}`}><FileText size={16}/><span><b>{f.name}</b><small>{formatSize(f.size)}</small></span><button onClick={() => setFiles(fs => fs.filter((_, n) => n !== i))} aria-label={`Remove ${f.name}`}><X size={15}/></button></div>)}</div>}</div><div className="settings-line"><div><b>Automatic file deletion</b><small>Remove uploaded files after the selected period.</small></div><select value={retention} onChange={e => setRetention(Number(e.target.value))}>{[1,3,7,14,21,30].map(n => <option key={n} value={n}>{n} days</option>)}</select></div><div className="settings-line"><div><b>Allow reviewer downloads</b><small>Reviewers can download the shared files.</small></div><Toggle checked={true} onChange={() => {}}/></div>{error && <div className="form-error">{error}</div>}<div className="editor-actions"><button className="button button-outline" disabled={busy} onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save draft'}</button><button className="button button-primary" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Save and share'} <ArrowRight size={15}/></button></div></div></section><aside className="editor-aside"><div className="aside-note"><span><ShieldCheck size={17}/></span><b>Private until you share</b><p>Draft projects are only visible to you. Reviewers can only access projects through their unique link.</p></div><div className="aside-note"><span><Clock3 size={17}/></span><b>Files have a time limit</b><p>We'll remind you before files are automatically removed.</p></div></aside></div></div></AppShell>
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) { return <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={onChange} aria-pressed={checked}><span/></button> }

function ProjectWorkspace(p: SharedProps) {
  const { id = '' } = useParams(); const navigate = useNavigate(); const project = p.state.projects.find(x => x.id === id); const [showEdit, setShowEdit] = useState(false); const [title, setTitle] = useState(project?.title || ''); const [client, setClient] = useState(project?.client || ''); const [preview, setPreview] = useState<ProjectFile | null>(null)
  if (!project) return <AppShell title="Project not found" state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><EmptyState title="This project isn't here" text="It may have been removed or the link may be incorrect." action="Back to projects" onClick={() => navigate('/projects')}/></AppShell>
  const canManage = !supabase || project.ownerId === p.state.user?.id
  const addFiles = async (list: FileList | null) => {
    if (!canManage) return p.setToast('Only the project owner can upload a new version.')
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
      const assignments = project.assignments?.map(assignment => ({ ...assignment, status: 'Pending' as const, respondedAt: undefined }))
      p.updateProject({ ...project, files: [...project.files, ...added], assignments, status: project.reviewToken ? 'Pending' : project.status, updatedAt: new Date().toISOString() })
      if (supabase) void notifyCloudReviewers(project.id, (project.assignments || []).map(assignment => assignment.reviewerId), 'New version ready to review', project.title).catch(err => p.setToast(err instanceof Error ? err.message : 'Could not notify reviewers'))
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
  return <AppShell title="Project workspace" subtitle="Files, feedback, and decisions." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="projects"><div className="workspace-wrap"><button className="back-link" onClick={() => navigate('/projects')}><ArrowLeft size={15}/> All projects</button><div className="workspace-title-row"><div><div className="crumb"><span>{project.client}</span><ChevronRight size={14}/><span>Project</span></div><h2>{project.title}</h2><div className="workspace-meta"><StatusPill status={project.status}/><span>Updated {dateLabel(project.updatedAt).toLowerCase()}</span>{project.dueDate && <span>Due {new Date(project.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}</div></div>{canManage && <button className="button button-outline" onClick={() => setShowEdit(true)}><MoreHorizontal size={17}/> Manage</button>}</div>
    <div className="workspace-grid"><div className="workspace-main"><section className="panel files-panel"><div className="panel-head"><div><h3>Files for review <span className="inline-count">{project.files.length}</span></h3><p>Current submission and file history</p></div>{canManage && <label className="button button-outline button-small upload-button"><Plus size={15}/> Add files<input type="file" multiple onChange={e => addFiles(e.target.files)}/></label>}</div>{project.files.length ? <div className="file-grid">{project.files.map(file => <div className="file-card" key={file.id}><button className="file-preview" onClick={() => void openFile(file)}>{isImage(file) && file.url ? <img src={file.url} alt={file.name}/> : <span className={`file-preview-placeholder ${file.type.startsWith('video') ? 'video-preview' : ''}`}>{file.type.startsWith('video') ? <Film size={31}/> : file.type === 'application/pdf' ? <FileText size={31}/> : <File size={31}/>}<small>{file.name.split('.').pop()?.toUpperCase()}</small></span>}<span className="version-chip">v{file.version}</span></button><div className="file-info"><b title={file.name}>{file.name}</b><small>{formatSize(file.size)} <span>·</span> {dateLabel(file.uploadedAt)}</small></div><button className="download-icon" title="Download" onClick={() => void downloadFile(file)}><ArrowDownToLine size={15}/></button></div>)}</div> : <div className="empty-files"><span><Upload size={20}/></span><b>No files added yet</b><p>Upload creative files to prepare this project for review.</p>{canManage && <label className="button button-outline button-small upload-button"><Plus size={15}/> Add files<input type="file" multiple onChange={e => addFiles(e.target.files)}/></label>}</div>}</section><section className="panel feedback-panel"><div className="panel-head"><div><h3>Feedback <span className="inline-count">{project.comments.length}</span></h3><p>Comments and decisions from reviewers</p></div></div>{project.comments.length ? <div className="comment-list">{project.comments.map(c => <Comment key={c.id} comment={c}/>)}</div> : <div className="feedback-empty"><MessageCircle size={18}/><span>No feedback yet. Share a review link to invite comments.</span></div>}</section></div><aside className="workspace-side"><section className="panel review-link-panel"><div className="panel-head"><div><h3>Review link</h3><p>Private access for your reviewers</p></div><span className={`link-state ${project.reviewToken ? 'live' : ''}`}>{project.reviewToken ? 'ACTIVE' : 'NOT SHARED'}</span></div>{project.reviewToken ? <><div className="share-url"><Link2 size={15}/><span>{link.replace(window.location.origin, '')}</span><button onClick={() => { navigator.clipboard?.writeText(link); p.setToast('Review link copied') }} aria-label="Copy review link"><FileText size={14}/></button></div><button className="button button-primary button-full" onClick={() => { navigator.clipboard?.writeText(link); p.setToast('Review link copied') }}><Link2 size={15}/> Copy review link</button><Link to={`/r/${project.reviewToken}`} target="_blank" className="open-review-link">Open reviewer view <ArrowRight size={14}/></Link></> : <><div className="link-empty"><span><Link2 size={18}/></span><p>Your reviewer link will appear here after you share the project.</p></div><button className="button button-primary button-full" onClick={share} disabled={!project.files.length || !canManage}>Share for review <ArrowRight size={15}/></button></>}</section>{canManage && Boolean(project.assignments?.length) && <section className="panel assigned-reviewers"><div className="panel-head"><div><h3>Assigned reviewers</h3><p>Personal links identify each response</p></div></div><div className="reviewer-assignment-list">{project.assignments?.map(assignment => <div className="reviewer-assignment" key={assignment.id}><span className="member-avatar">{initials(assignment.reviewerName)}</span><span><b>{assignment.reviewerName}</b><small>@{assignment.username} · {assignment.status}</small></span><button className="icon-button" title={`Copy ${assignment.reviewerName}'s link`} onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/r/${assignment.token}`); p.setToast(`Link copied for ${assignment.reviewerName}`) }}><Copy size={15}/></button></div>)}</div></section>}<section className="panel project-info-panel"><h3>Project details</h3><InfoLine label="Client / team" value={project.client}/><InfoLine label="File retention" value={`${project.retentionDays} days`}/><InfoLine label="Downloads" value={project.allowDownload ? 'Allowed' : 'Disabled'}/>{canManage && <button className="settings-inline" onClick={() => setShowEdit(true)}><Settings size={14}/> Edit project details</button>}</section><section className="retention-warning"><Clock3 size={16}/><p>Files are automatically removed after <b>{project.retentionDays} days</b>. We'll remind you before deletion.</p></section></aside></div></div>
    {showEdit && canManage && <Modal title="Manage project" onClose={() => setShowEdit(false)}><div className="form-stack"><label>Project name<input value={title} onChange={e => setTitle(e.target.value)}/></label><label>Client or team<input value={client} onChange={e => setClient(e.target.value)}/></label><div className="settings-line"><div><b>Allow reviewer downloads</b><small>Reviewers can download the shared files.</small></div><Toggle checked={project.allowDownload} onChange={() => p.updateProject({ ...project, allowDownload: !project.allowDownload })}/></div><div className="modal-actions"><button className="button button-outline danger-button" onClick={() => { setShowEdit(false); if (window.confirm('Delete this project and its feedback?')) p.deleteProject(project.id) }}>Delete project</button><button className="button button-primary" onClick={saveEdit}>Save changes</button></div></div></Modal>}
    {preview && <Modal title={preview.name} onClose={() => setPreview(null)} wide><FilePreview file={preview}/><div className="preview-caption">Version {preview.version} · {formatSize(preview.size)} · Uploaded {new Date(preview.uploadedAt).toLocaleString()}</div></Modal>}
  </AppShell>
}
function InfoLine({ label, value }: { label: string; value: string }) { return <div className="info-line"><span>{label}</span><b>{value}</b></div> }
function Comment({ comment }: { comment: ReviewComment }) { return <div className="comment-row"><span className={`comment-avatar-small ${comment.kind}`}>{comment.kind === 'approval' ? <Check size={15}/> : initials(comment.author)}</span><div><div className="comment-author"><b>{comment.author}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></div>{comment.kind !== 'comment' && <span className={`decision-label ${comment.kind}`}>{comment.kind === 'approval' ? 'Approved' : 'Changes requested'}</span>}<p>{comment.body}</p></div></div> }

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) { return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className={`modal ${wide ? 'modal-wide' : ''}`}><div className="modal-heading"><h3>{title}</h3><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></div>{children}</section></div> }

function FilePreview({ file }: { file: ProjectFile }) {
  const [zoom, setZoom] = useState(1)
  return <div className="preview-modal-content">
    {file.url && file.type.startsWith('image/') ? <><div className="zoom-toolbar"><span>Image zoom</span><div><button onClick={() => setZoom(z => Math.max(.5, +(z - .25).toFixed(2)))} aria-label="Zoom out"><ZoomOut size={15}/></button><button className="zoom-level" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(z => Math.min(3, +(z + .25).toFixed(2)))} aria-label="Zoom in"><ZoomIn size={15}/></button></div></div><div className="zoom-stage"><img src={file.url} alt={file.name} style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? '68vh' : 'none' }}/></div></>
      : file.url && file.type.startsWith('video/') ? <video src={file.url} controls/>
        : file.url && file.type === 'application/pdf' ? <iframe title={file.name} src={file.url}/>
          : <div className="preview-unavailable"><FileText size={42}/><p>Preview is available for images, video, and PDFs. Download this document to open it.</p></div>}
  </div>
}

function ReviewPage({ state, updateProject, notify, refreshCloud }: Pick<SharedProps, 'state' | 'updateProject' | 'notify' | 'refreshCloud'>) {
  const { token = '' } = useParams(); const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [done, setDone] = useState(''); const [preview, setPreview] = useState<ProjectFile | null>(null); const [cloudProject, setCloudProject] = useState<Project | null>(null); const [cloudLoading, setCloudLoading] = useState(Boolean(supabase))
  const localProject = state.projects.find(p => p.reviewToken === token || p.assignments?.some(a => a.token === token)) || null
  const localAssignment = localProject?.assignments?.find(a => a.token === token)
  const assignedReviewer = supabase ? cloudProject?.reviewerName : localAssignment?.reviewerName
  const reviewerApproved = (supabase ? cloudProject?.reviewAssignmentStatus : localAssignment?.status) === 'Approved'
  const hasReviewAssignments = supabase ? Boolean(cloudProject?.hasReviewAssignments) : Boolean(localProject?.assignments?.length)
  const reviewIsAssigned = supabase ? Boolean(cloudProject?.reviewIsAssigned) : Boolean(localAssignment)
  const assignmentRequired = hasReviewAssignments && !reviewIsAssigned
  useEffect(() => { if (assignedReviewer) setName(assignedReviewer) }, [assignedReviewer])
  useEffect(() => {
    if (!supabase) return
    let alive = true
    setCloudLoading(true)
    loadPublicReview(token).then(value => { if (alive) { setCloudProject(value); if (value?.reviewerName) setName(value.reviewerName) } }).catch(err => { if (alive) setDone(err instanceof Error ? err.message : 'This review could not be loaded.') }).finally(() => { if (alive) setCloudLoading(false) })
    return () => { alive = false }
  }, [token])
  const sourceProject = supabase ? cloudProject : localProject
  const latestFiles = sourceProject?.files.reduce((latest, file) => {
    const current = latest.get(file.name)
    if (!current || file.version > current.version || (file.version === current.version && file.uploadedAt > current.uploadedAt)) latest.set(file.name, file)
    return latest
  }, new Map<string, ProjectFile>())
  const project = sourceProject ? { ...sourceProject, files: Array.from(latestFiles?.values() || []) } : null
  const respond = async (kind: ReviewComment['kind']) => {
    if (!project || !name.trim()) return setDone('Please enter your name so the team knows who responded.')
    if (kind === 'comment' && !message.trim()) return setDone('Write a comment before sending.')
    if (assignmentRequired && kind !== 'comment') return setDone('Use your assigned review link to approve or request changes.')
    const body = kind === 'approval' ? 'Approved this submission.' : kind === 'changes' ? message.trim() || 'Please make the requested changes.' : message.trim()
    if (supabase) {
      try {
        await submitCloudReview(token, name.trim(), body, kind)
        setCloudProject(await loadPublicReview(token))
        await refreshCloud()
        setDone(kind === 'approval' ? 'Approval recorded. Thank you!' : kind === 'changes' ? 'Your change request has been sent.' : 'Your comment has been added.')
        setMessage('')
      } catch (err) { setDone(err instanceof Error ? err.message : 'Your response could not be sent.') }
      return
    }
    const assignments = (project.assignments || []).map(a => a.token === token && kind !== 'comment' ? { ...a, status: kind === 'approval' ? 'Approved' as const : 'Changes requested' as const, respondedAt: new Date().toISOString() } : a)
    const assigned = assignments.some(a => a.token === token)
    const status: ProjectStatus = assigned ? assignments.some(a => a.status === 'Changes requested') ? 'Changes requested' : assignments.length > 0 && assignments.every(a => a.status === 'Approved') ? 'Approved' : 'Pending' : kind === 'approval' ? 'Approved' : kind === 'changes' ? 'Changes requested' : project.status
    const updated: Project = { ...project, assignments, status, updatedAt: new Date().toISOString(), comments: [...project.comments, { id: crypto.randomUUID(), author: localAssignment?.reviewerName || name.trim(), body, createdAt: new Date().toISOString(), kind }] }
    updateProject(updated); notify(kind === 'approval' ? 'Project approved' : kind === 'changes' ? 'Changes requested' : 'New reviewer comment', project.title, project.id); setMessage(''); setDone(kind === 'approval' ? 'Approval recorded. Thank you!' : kind === 'changes' ? 'Your change request has been sent.' : 'Your comment has been added.')
  }
  if (cloudLoading) return <main className="review-page"><div className="review-locked"><Link to="/" className="plain-link"><Logo/></Link><span><ShieldCheck size={24}/></span><h1>Opening review…</h1><p>Loading the latest files and feedback.</p></div></main>
  if (!project || project.status === 'Draft') return <main className="review-page"><div className="review-locked"><Link to="/" className="plain-link"><Logo/></Link><span><ShieldCheck size={24}/></span><h1>This review link isn't available</h1><p>The project is private or this link may have expired. Ask the person who shared it for a current link.</p></div></main>
  return <main className="review-page"><header className="review-header"><Link to="/" className="plain-link"><Logo/></Link><span className="review-header-label"><ShieldCheck size={14}/> Secure review link</span></header><div className="review-content"><div className="review-heading"><span className="eyebrow">PROJECT REVIEW</span><h1>{project.title}</h1><p>{project.client}{project.description ? ` · ${project.description}` : ''}</p><div className="workspace-meta"><StatusPill status={project.status}/><span>Updated {dateLabel(project.updatedAt).toLowerCase()}</span></div></div><div className="review-layout"><section className="review-files"><div className="review-section-head"><div><h2>Files for review</h2><p>{project.files.length} {project.files.length === 1 ? 'file' : 'files'} · Latest version</p></div></div><div className="review-file-list">{project.files.map(f => <div className="review-file-wrap" key={f.id}><button className="review-file-card" onClick={() => setPreview(f)}><span className="review-file-thumb">{f.type.startsWith('image') && f.url ? <img src={f.url} alt=""/> : f.type.startsWith('video') ? <Film size={23}/> : <FileText size={23}/>}</span><span><b>{f.name}</b><small>Version {f.version} · {formatSize(f.size)}</small></span><ChevronRight size={17}/></button>{project.allowDownload && f.url && <a className="review-download" href={f.url.replace('&inline=1', '')} download={f.name}><ArrowDownToLine size={13}/> Download file</a>}</div>)}{!project.files.length && <div className="feedback-empty">No files have been added yet.</div>}</div><div className="review-comments"><h2>Comments and decisions <span>{project.comments.length}</span></h2>{project.comments.map(c => <Comment key={c.id} comment={c}/>)}{!project.comments.length && <p className="no-comments">No comments yet. Add the first note below.</p>}</div></section><aside className="review-response panel"><div className="review-response-heading"><span><MessageCircle size={17}/></span><div><h2>Share your feedback</h2><p>{assignedReviewer ? `Assigned to ${assignedReviewer}` : 'Your name helps the team follow up.'}</p></div></div><label className="review-name">{assignedReviewer ? 'Reviewer' : 'Your name'}<input value={name} onChange={e => setName(e.target.value)} readOnly={Boolean(assignedReviewer)} placeholder="e.g. Maya Okafor"/></label><label className="review-name">Comment<textarea rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="Share a note or request a change…"/></label>{done && <div className={done.includes('Please') || done.includes('Write') ? 'form-error' : 'success-note'}>{done}</div>}{reviewerApproved && <div className="success-note">You have approved this version. Your approval stays saved for this version.</div>}{assignmentRequired && <div className="member-empty">This project has assigned reviewers. Use your personal review link to record a decision.</div>}<button className="button button-outline button-full" onClick={() => void respond('comment')}><MessageCircle size={15}/> Add comment</button><button className="button button-outline button-full request-button" disabled={project.status === 'Approved' || reviewerApproved || assignmentRequired} onClick={() => void respond('changes')}>Request changes</button><button className="button button-primary button-full" disabled={project.status === 'Approved' || reviewerApproved || assignmentRequired} onClick={() => void respond('approval')}><CheckCheck size={15}/>{reviewerApproved ? 'Approved by you' : project.status === 'Approved' ? 'Approved' : 'Approve this work'}</button>{project.allowDownload && <p className="download-permission"><ArrowDownToLine size={14}/> Downloads are allowed for this project.</p>}</aside></div><footer className="review-footer"><span>Powered by <Logo/></span><span>Feedback stays with the project.</span></footer></div>{preview && <Modal title={preview.name} onClose={() => setPreview(null)} wide><FilePreview file={preview}/></Modal>}</main>
}

function NotificationsPage(p: SharedProps) {
  const navigate = useNavigate()
  return <AppShell title="Notifications" subtitle="In-app updates on your reviews and files." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="notifications"><div className="notification-page"><div className="notification-toolbar"><span>{p.state.notices.filter(n => !n.read).length} unread</span><button className="text-link" onClick={() => p.state.notices.forEach(n => p.markRead(n.id))}><CheckCheck size={15}/> Mark all as read</button></div><section className="panel notifications-list">{p.state.notices.map(n => <button key={n.id} className={`notification-row ${n.read ? '' : 'unread'}`} onClick={() => { p.markRead(n.id); if (n.projectId) navigate(`/projects/${n.projectId}`) }}><span className="notification-symbol"><Bell size={17}/></span><span><b>{n.title}</b><small>{n.detail}</small></span><time>{n.time}</time>{!n.read && <i/>}</button>)}{p.state.notices.length === 0 && <EmptyState title="You're all caught up" text="New comments, approvals, and file reminders will show here."/>}</section></div></AppShell>
}
function ProfilePage(p: SharedProps) {
  const user = p.state.user!
  const [form, setForm] = useState({ name: user.name, username: user.username, organization: user.organization || '', department: user.department || '', position: user.position || '' })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const initialsText = initials(form.name || user.name || 'RD')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const name = form.name.trim()
    const username = form.username.trim().toLowerCase()
    if (name.length < 2) { p.setToast('Enter your full name'); return }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) { p.setToast('Username must be 3–24 characters using letters, numbers, or underscores'); return }
    const updatedUser: User = { ...user, name, username, organization: form.organization.trim(), department: form.department.trim(), position: form.position.trim() }
    setBusy(true); setSaved(false)
    try {
      if (supabase) await saveCloudProfile(updatedUser)
      p.setState(current => ({ ...current, user: updatedUser }))
      setSaved(true); p.setToast('Profile updated')
    } catch (error) { p.setToast(error instanceof Error ? error.message : 'Could not update your profile') }
    finally { setBusy(false) }
  }
  return <AppShell title="Profile" subtitle="The details people see when working with you." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="profile"><div className="profile-page"><section className="panel profile-card"><div className="profile-card-heading"><span className="profile-large-avatar">{initialsText}</span><div><h2>{form.name || 'Your name'}</h2><p>@{form.username || 'username'}{form.position ? ` · ${form.position}` : ''}</p></div></div><form className="profile-form" onSubmit={save}><div className="profile-field-grid"><label>Full name<input required autoComplete="name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. David Olowogoke"/></label><label>Username<input required autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value.replace(/\s/g, '') }))} placeholder="e.g. david_o"/><small>Your colleagues can use this to find you.</small></label><label>Email address<input type="email" value={user.email} disabled/><small>Contact support to change your sign-in email.</small></label><label>Organization<input autoComplete="organization" value={form.organization} onChange={event => setForm(current => ({ ...current, organization: event.target.value }))} placeholder="e.g. Khaydave Media"/></label><label>Department<input value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value }))} placeholder="e.g. Design"/></label><label>Position<input autoComplete="organization-title" value={form.position} onChange={event => setForm(current => ({ ...current, position: event.target.value }))} placeholder="e.g. Creative designer"/></label></div><div className="profile-form-footer"><p>Your profile details help colleagues recognize you when assigning reviews.</p><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : saved ? <><Check size={16}/> Saved</> : 'Save profile'}</button></div></form></section><section className="profile-privacy-note"><ShieldCheck size={17}/><span><b>Your email stays private.</b> ReviewDesk uses your username and display name to identify you to colleagues.</span></section></div></AppShell>
}
function SettingsPage(p: SharedProps) {
  const [retention, setRetention] = useState('14'); const [saved, setSaved] = useState(false)
  const { theme, setTheme } = useUiPreferences()
  return <AppShell title="Settings" subtitle="Your account preferences and connected services." state={p.state} search={p.search} setSearch={p.setSearch} mobileNav={p.mobileNav} setMobileNav={p.setMobileNav} logout={p.logout} active="settings"><div className="settings-page"><section className="panel settings-section"><div className="settings-section-title"><span><Sun size={20}/></span><div><h3>Appearance</h3><p>Choose the light or dark theme for ReviewDesk.</p></div></div><div className="theme-choice" role="group" aria-label="Appearance theme"><button type="button" className={theme === 'light' ? 'selected' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={18}/> Light</button><button type="button" className={theme === 'dark' ? 'selected' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={18}/> Dark</button></div><div className="display-size-note">Your choice is saved in this browser and applies across ReviewDesk.</div></section><section className="panel settings-section"><div className="settings-section-title"><span><ALargeSmall size={20}/></span><div><h3>Display size</h3><p>Make text and icons smaller or larger across ReviewDesk.</p></div></div><DisplaySizeControl expanded/><div className="display-size-note">Your preference is saved in this browser and also applies to the landing page.</div></section><section className="panel settings-section"><div className="settings-section-title"><span><Clock3 size={20}/></span><div><h3>File retention</h3><p>Choose when project files are automatically deleted.</p></div></div><div className="settings-control"><div><b>Default retention period</b><small>Each project can set its own retention period.</small></div><select value={retention} onChange={e => { setRetention(e.target.value); setSaved(false) }}>{[1,3,7,14,21,30].map(n => <option key={n} value={n}>{n} days</option>)}</select></div><div className="retention-info"><Bell size={17}/><span>ReviewDesk will show an in-app reminder before files are deleted. File deletion runs automatically when Cloudflare Worker services are configured.</span></div><button className="button button-primary button-small" onClick={() => { setSaved(true); p.setToast('Settings saved') }}>{saved ? <><Check size={17}/> Saved</> : 'Save settings'}</button></section><section className="panel settings-section"><div className="settings-section-title"><span><ShieldCheck size={20}/></span><div><h3>Connected services</h3><p>Services that power secure accounts, data, and file storage.</p></div></div><ServiceRow name="Supabase" description="Authentication and project database" ready={Boolean(supabase)}/><ServiceRow name="Cloudflare R2" description="Original quality file storage" ready={Boolean(import.meta.env.VITE_UPLOAD_WORKER_URL)}/><ServiceRow name="Cloudflare Pages" description="App hosting and deployment" ready={false}/><div className="env-tip"><b>Set up your services</b><p>Add the Supabase URL, public anon key, and upload Worker URL to your Cloudflare Pages environment variables. See the README for the database schema and deployment steps.</p><code>VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY · VITE_UPLOAD_WORKER_URL</code></div></section><section className="panel settings-section account-section"><div className="settings-section-title"><span><Settings size={20}/></span><div><h3>Account</h3><p>Signed in as {p.state.user?.email}</p></div></div><button className="button button-outline button-small" onClick={p.logout}><LogOut size={17}/> Sign out</button></section></div></AppShell>
}
function ServiceRow({ name, description, ready }: { name: string; description: string; ready: boolean }) { return <div className="service-row"><span className={`service-mark ${ready ? 'connected' : ''}`}>{ready ? <Check size={15}/> : <span/>}</span><span><b>{name}</b><small>{description}</small></span><span className={`service-status ${ready ? 'connected' : ''}`}>{ready ? 'Connected' : 'Not connected'}</span></div> }
