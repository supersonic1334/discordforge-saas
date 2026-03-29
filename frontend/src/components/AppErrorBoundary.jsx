import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('App crash boundary caught an error:', error)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleAuth = () => {
    window.location.assign('/auth')
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="min-h-[var(--app-height)] bg-surface-0 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl border border-white/[0.08] bg-surface-1/90 backdrop-blur-xl p-8 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-300">
            <span className="text-2xl font-bold">!</span>
          </div>
          <h1 className="font-display text-3xl font-700 text-white">Chargement interrompu</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            Le site a rencontre un probleme de chargement. Recharge la page pour relancer l interface.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-violet px-4 py-3 text-sm font-display font-600 text-white shadow-neon-cyan transition-opacity hover:opacity-90"
            >
              Recharger
            </button>
            <button
              type="button"
              onClick={this.handleAuth}
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-display font-600 text-white/80 transition-all hover:bg-white/[0.07] hover:text-white"
            >
              Retour connexion
            </button>
          </div>
        </div>
      </div>
    )
  }
}
