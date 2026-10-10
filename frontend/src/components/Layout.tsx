import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router'
import AssistedBar from '../features/assisted/AssistedBar'
import { useApp } from '../store/app'

export default function Layout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { assisted, health, healthError } = useApp()

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="flex items-center gap-3 bg-brand px-4 py-3 text-white">
        {pathname !== '/' && (
          <Link to="/" aria-label={t('common.back')} className="-ml-1 rounded-full p-1 hover:bg-white/10">
            <ArrowLeft className="size-6" />
          </Link>
        )}
        <img src="/logo.svg" alt="" className="size-8" />
        <span className="text-lg font-semibold">{t('app.name')}</span>
      </header>
      {assisted && <AssistedBar />}
      {healthError && <p className="bg-red-100 px-4 py-2 text-sm text-red-900">{t('common.offline')}</p>}
      {health?.llm === 'mock' && <p className="bg-amber-100 px-4 py-2 text-sm text-amber-900">{t('common.mockMode')}</p>}
      {health?.llm === 'local' && <p className="bg-amber-100 px-4 py-2 text-sm text-amber-900">{t('common.localMode')}</p>}
      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  )
}
