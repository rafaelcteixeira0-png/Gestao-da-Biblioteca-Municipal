import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Landmark,
  Menu,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { ModulePage } from './components/ModulePage'
import { navigation, pageFromHash, searchFromHash } from './navigation'
import type { Navigate, Page } from './navigation'
import { formatNumber, normalize, readers, stats, works } from './data/demo'

function Sidebar({
  page,
  navigate,
  mobile = false,
  onClose,
}: {
  page: Page
  navigate: Navigate
  mobile?: boolean
  onClose?: () => void
}) {
  return (
    <>
      <div className="brand">
        <span className="brand-icon">
          <BookOpen size={26} strokeWidth={1.8} />
        </span>
        <div>
          <strong>
            Biblioteca<span>Municipal</span>
          </strong>
          <small>CIANORTE · PARANÁ</small>
        </div>
        {mobile && (
          <button
            className="icon-button close-menu"
            onClick={onClose}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        )}
      </div>
      <nav aria-label="Menu principal">
        <a href="#atendimento" className="nav-link">
          <ShieldCheck size={19} strokeWidth={1.7} />
          <span>Atendimento</span>
        </a>
        {['PRINCIPAL', 'CADASTROS', 'ANÁLISE'].map((group) => (
          <div className="nav-group" key={group}>
            <p>{group}</p>
            {navigation
              .filter((item) => item.group === group)
              .map(({ id, label, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`nav-link ${page === id ? 'active' : ''}`}
                  aria-current={page === id ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    navigate(id)
                  }}
                >
                  <Icon size={19} strokeWidth={1.7} />
                  <span>{label}</span>
                  {id === 'emprestimos' && (
                    <span className="nav-count">{stats.open}</span>
                  )}
                </a>
              ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <BookOpen size={22} />
          <strong>Um novo capítulo.</strong>
          <p>
            Mais tempo para os livros.
            <br />
            Mais cuidado com as pessoas.
          </p>
        </div>
        <div className="municipality">
          <Landmark size={19} />
          <span>
            Biblioteca Pública Municipal<small>Cianorte, Paraná</small>
          </span>
        </div>
        <span className="demo-marker">
          <span />
          Ambiente demonstrativo
        </span>
      </div>
    </>
  )
}

function GlobalSearch({ navigate }: { navigate: Navigate }) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const term = normalize(query)
  const results = term
    ? [
        ...works
          .filter((work) =>
            normalize(`${work.title} ${work.author} ${work.id}`).includes(term),
          )
          .slice(0, 3)
          .map((work) => ({
            id: work.id,
            label: work.title,
            type: 'Livro',
            page: 'livros' as Page,
          })),
        ...readers
          .filter((reader) =>
            normalize(`${reader.name} ${reader.id}`).includes(term),
          )
          .slice(0, 3)
          .map((reader) => ({
            id: reader.id,
            label: reader.name,
            type: 'Leitor',
            page: 'leitores' as Page,
          })),
      ]
    : []
  return (
    <div
      className="global-search"
      ref={container}
      onBlur={(event) => {
        if (!container.current?.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <Search size={18} />
      <input
        type="search"
        aria-label="Buscar livros ou leitores"
        placeholder="Buscar livros ou leitores..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setFocused(true)
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setFocused(false)
        }}
        aria-controls={focused && term ? 'global-search-results' : undefined}
      />
      <span className="search-hint">Busca</span>
      {focused && term && (
        <div
          id="global-search-results"
          className="search-results"
          role="region"
          aria-label="Resultados da busca"
        >
          <p>RESULTADOS DA DEMONSTRAÇÃO</p>
          {results.length ? (
            results.map((result) => (
              <button
                key={result.id}
                onClick={() => {
                  navigate(result.page, result.id)
                  setQuery('')
                  setFocused(false)
                }}
              >
                <span className="result-icon">
                  {result.type === 'Livro' ? (
                    <BookOpen size={17} />
                  ) : (
                    <Search size={17} />
                  )}
                </span>
                <span>
                  {result.label}
                  <small>
                    {result.type} · {result.id}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <div className="search-empty">Nenhum resultado para “{query}”.</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [moduleSearch, setModuleSearch] = useState(searchFromHash)
  const [headerPanel, setHeaderPanel] = useState<'alerts' | 'profile' | null>(
    null,
  )
  const mobileDialog = useRef<HTMLDialogElement>(null)
  const helpDialog = useRef<HTMLDialogElement>(null)
  const headerPanels = useRef<HTMLDivElement>(null)
  const panel = navigation.find((item) => item.id === page)!

  useEffect(() => {
    const onHash = () => {
      if (
        !navigation.some(
          (item) => item.id === window.location.hash.slice(1).split('?')[0],
        )
      )
        return
      setPage(pageFromHash())
      setModuleSearch(searchFromHash())
      setHeaderPanel(null)
      mobileDialog.current?.close()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!headerPanel) return
    const onPointer = (event: PointerEvent) => {
      if (!headerPanels.current?.contains(event.target as Node))
        setHeaderPanel(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHeaderPanel(null)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [headerPanel])

  const navigate: Navigate = (nextPage, search = '') => {
    setPage(nextPage)
    setModuleSearch(search)
    setHeaderPanel(null)
    mobileDialog.current?.close()
    const nextHash = `#${nextPage}${search ? `?busca=${encodeURIComponent(search)}` : ''}`
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Ir para o conteúdo
      </a>
      <aside className="sidebar">
        <Sidebar page={page} navigate={navigate} />
      </aside>
      <dialog
        className="mobile-sidebar"
        ref={mobileDialog}
        aria-label="Navegação da biblioteca"
        onClick={(event) => {
          if (event.target === event.currentTarget)
            mobileDialog.current?.close()
        }}
      >
        <Sidebar
          page={page}
          navigate={navigate}
          mobile
          onClose={() => mobileDialog.current?.close()}
        />
      </dialog>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              aria-label="Abrir menu"
              onClick={() => mobileDialog.current?.showModal()}
            >
              <Menu size={22} />
            </button>
            <span>Visão geral</span>
            <ChevronRight size={14} />
            <strong>{panel.label}</strong>
          </div>
          <GlobalSearch navigate={navigate} />
          <div className="header-actions" ref={headerPanels}>
            <button
              className="icon-button notification-button"
              aria-label="Notificações de demonstração"
              aria-expanded={headerPanel === 'alerts'}
              aria-controls="alerts-panel"
              onClick={() =>
                setHeaderPanel(headerPanel === 'alerts' ? null : 'alerts')
              }
            >
              <Bell size={20} />
              <span className="notification-dot" />
            </button>
            <span className="header-divider" />
            <button
              className="profile-button"
              aria-label="Perfil de demonstração"
              aria-expanded={headerPanel === 'profile'}
              aria-controls="profile-panel"
              onClick={() =>
                setHeaderPanel(headerPanel === 'profile' ? null : 'profile')
              }
            >
              <span className="avatar profile-avatar">BM</span>
              <span className="profile-label">
                <strong>Equipe da biblioteca</strong>
                <small>Perfil demonstrativo</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {headerPanel === 'alerts' && (
              <div className="header-popover" id="alerts-panel">
                <h2>Seu dia na biblioteca</h2>
                <p>Alertas do cenário fictício de 13/10/2026.</p>
                <button onClick={() => navigate('emprestimos', 'atraso')}>
                  <span className="alert-dot red" />
                  <span>
                    <strong>{stats.overdue} empréstimos em atraso</strong>
                    <small>Consulte as pendências de exemplo</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => navigate('emprestimos', 'hoje')}>
                  <span className="alert-dot amber" />
                  <span>
                    <strong>{stats.dueToday} vencimentos hoje</strong>
                    <small>Acompanhe as devoluções previstas</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            {headerPanel === 'profile' && (
              <div
                className="header-popover profile-popover"
                id="profile-panel"
              >
                <ShieldCheck size={26} />
                <h2>Perfil demonstrativo</h2>
                <p>
                  Você está explorando a primeira versão da interface com dados
                  fictícios.
                </p>
                <span className="subtle-badge">
                  Autenticação prevista em uma próxima etapa
                </span>
              </div>
            )}
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {page === 'dashboard' ? (
            <Dashboard navigate={navigate} />
          ) : (
            <ModulePage
              key={`${page}:${moduleSearch}`}
              page={page}
              initialSearch={moduleSearch}
            />
          )}
          <footer className="page-footer">
            <span>Biblioteca Pública Municipal de Cianorte</span>
            <span>
              <span className="footer-dot" />
              Todos os dados são fictícios{' '}
              <span className="footer-separator">·</span> v0.1
            </span>
          </footer>
        </main>
      </div>
      <button
        className="help-button"
        aria-label="Sobre este protótipo"
        onClick={() => helpDialog.current?.showModal()}
      >
        <CircleHelp size={21} />
      </button>
      <dialog
        className="help-dialog"
        ref={helpDialog}
        aria-labelledby="help-title"
      >
        <button
          className="icon-button dialog-close"
          aria-label="Fechar informações"
          onClick={() => helpDialog.current?.close()}
        >
          <X size={20} />
        </button>
        <span className="help-icon">
          <BookOpen size={30} />
        </span>
        <span className="eyebrow">BIBLIOTECA MUNICIPAL DE CIANORTE</span>
        <h2 id="help-title">Um novo capítulo para a gestão.</h2>
        <p>
          Esta primeira entrega apresenta o dashboard e a navegação do futuro
          sistema da biblioteca.
        </p>
        <p>
          Os {formatNumber(stats.books)} exemplares, {stats.readers} leitores e
          todas as movimentações pertencem a um cenário fictício, com data de
          referência em <strong>13 de outubro de 2026</strong>.
        </p>
        <p>
          Cadastros, operações e autenticação serão desenvolvidos nas próximas
          etapas, após a validação das regras com a biblioteca.
        </p>
        <button
          className="button button-primary"
          onClick={() => helpDialog.current?.close()}
        >
          Entendi
          <ChevronRight size={16} />
        </button>
      </dialog>
    </div>
  )
}
