import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores'
import { useI18n } from '../i18n'

export default function OAuthCallback() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { fetchMe, setToken } = useAuthStore()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const error = params.get('error')
    const verified = params.get('verified') === '1'
    const loginApproved = params.get('login_approved') === '1'
    if (token) {
      localStorage.setItem('token', token)
      setToken(token)
      fetchMe().then(() => {
        if (verified) {
          toast.success('Adresse e-mail validee')
        } else if (loginApproved) {
          toast.success('Connexion approuvee')
        }
        navigate('/dashboard')
      })
    } else {
      toast.error(error || t('oauth.failed'))
      navigate('/auth')
    }
  }, [])

  return (
    <div className="min-h-[var(--app-height)] bg-surface-0 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin mx-auto mb-3" />
        <p className="text-white/40 font-mono">{t('oauth.loading')}</p>
      </div>
    </div>
  )
}
