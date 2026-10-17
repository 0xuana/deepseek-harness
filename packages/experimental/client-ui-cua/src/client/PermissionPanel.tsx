/** Native permission status and revocable application consent on the existing plugin page. */
import { useEffect, useState } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CuaApplicationGrant, CuaSystemPermissionState } from '@deepseek-ai/dsh-cua/types'
import type { PermissionFace } from './controller.ts'
import type { NS } from './locales.ts'
import css from './PermissionPanel.module.css'

/** Renderer-bound permission observation and localized controls. */
export type PermissionProps = InjectFace<PermissionFace> & PropsLocale<typeof NS>

/** Permission guidance only navigates to the existing bundle details. */
export type PermissionSetupProps = PermissionProps
  & Pick<PropsRuntime<'plugins.bundle.activation'>, 'onDismiss' | 'onOpenDetails'>

type DefaultPresetProps = PropsLocale<typeof NS> & Pick<PropsRuntime<'plugins.bundle.config'>, 'busy'> & InjectFace<{
  hooks: { cuaDefaultPreset: ConfigForm<{ default: string; selectedDefault?: string }> }
  setPtcDefault: () => Promise<boolean>
}>

/** The detail page owns the optional new-session default action. */
export type PermissionPanelProps = PermissionProps & DefaultPresetProps

function DefaultPresetSetting(props: DefaultPresetProps) {
  const { t } = props
  const preset = props.useCuaDefaultPreset(value => value)
  const isPtc = (preset.value?.selectedDefault ?? preset.value?.default) === 'ptc'
  const loading = preset.value === undefined && (props.busy === true || preset.status === 'loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setDefault = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      if (!await props.setPtcDefault()) setError(t('defaultNotSaved'))
    } catch (error) {
      setError(t('defaultFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally { setSaving(false) }
  }
  return <div className={css.defaultSetting} role="group" aria-label={t('defaultTitle')}>
    <div className={css.permission}>
      <div><strong>{t('defaultTitle')}</strong><p>{t('defaultBody')}</p></div>
      {loading ? <span className={css.buttonPlaceholder} aria-hidden />
        : <Button size="sm" variant={isPtc ? 'outline' : 'primary'} disabled={props.busy === true || saving || isPtc || !preset.writable || preset.status !== 'ready'}
          onClick={() => { void setDefault() }}>{t(isPtc ? 'defaultSet' : 'defaultConfirm')}</Button>}
    </div>
    {!props.busy && !isPtc && (preset.status === 'unavailable' ? <p className={css.error} role="alert">{t('defaultUnavailable')}</p>
      : preset.status === 'ready' && !preset.writable && <p className={css.error} role="alert">{t('defaultReadOnly')}</p>)}
    {!props.busy && error !== null && <p className={css.error} role="alert">{error}</p>}
  </div>
}

function Applications({ title, apps, icons, onAction, label, disabled }: {
  title: string
  apps: readonly CuaApplicationGrant[]
  icons: Record<string, string> | null
  disabled: boolean
  label: string
  onAction: PermissionProps['revoke']
}) {
  return <section className={css.group}>
    <h4>{title}</h4>
    <ul className={css.apps}>{apps.map(app => <li key={app.id}>
      <div className={css.application} title={app.executablePath}>
        {icons?.[app.executablePath] !== undefined ? <img src={icons[app.executablePath]} alt="" width={32} height={32} draggable={false} />
          : <span className={css.iconPlaceholder} aria-hidden />}
        <strong>{app.name}</strong>
      </div>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => { onAction(app.id) }}>{label}</Button>
    </li>)}</ul>
  </section>
}

function PermissionDescription({ application, permission, loading, t }: Pick<PermissionProps, 't'> & {
  application: CuaSystemPermissionState['launchApplication']
  permission: 'accessibility' | 'screenRecording'
  loading: boolean
}) {
  if (!loading && application === undefined) return <p>{t(permission === 'accessibility' ? 'accessibilityUse' : 'screenRecordingUse')}</p>
  return <p>
    {t('permissionPrefix')}{' '}
    <span className={css.applicationBadge}>
      {application === undefined ? <span className={css.appPlaceholder} aria-hidden /> : <>
        {application.icon !== undefined && <img src={application.icon} alt="" width={20} height={20} draggable={false} />}
        <span>{application.name}</span>
      </>}
    </span>{' '}
    {t(permission === 'accessibility' ? 'accessibilityAction' : 'screenRecordingAction')}
  </p>
}

/** @param props Host observation and explicit user actions. @returns Permission controls without automatic system prompts. */
export function PermissionPanel(props: PermissionPanelProps) {
  const { t, refresh, setActive } = props
  const state = props.useCuaPermissions(value => value)
  const observed = state.system.value
  const apps = state.applications.value
  const transitioning = props.busy === true
  const busy = transitioning || state.system.busy
  const appsBusy = transitioning || state.applications.busy
  const loading = observed === null && (busy || state.system.error === null)
  const application = !busy && state.system.error !== null ? undefined : observed?.launchApplication
  useEffect(() => {
    setActive(!transitioning)
    if (transitioning) return
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [transitioning, refresh, setActive])
  return <div className={css.panels} data-cua-settings aria-busy={transitioning || state.busy || loading}>
    <section className={css.panel} aria-label={t('title')}>
      <h3>{t('title')}</h3>
      <div className={css.card}>
        <DefaultPresetSetting {...props} />
        {!busy && state.system.error !== null && <div className={css.notice} role="alert">
          <span className={css.error}>{t('queryFailed', { message: state.system.error })}</span>
          <Button size="sm" variant="outline" disabled={state.system.busy} onClick={refresh}>{t('retry')}</Button>
        </div>}
        {(['accessibility', 'screenRecording'] as const).map(permission => <div className={css.permission} key={permission}
          role="group" aria-label={t(permission)}>
          <div>
            <strong>{t(permission)}</strong>
            <PermissionDescription application={application} permission={permission} loading={loading} t={t} />
          </div>
          <span className={css.permissionStatus}>{loading ? <span className={css.statusPlaceholder} aria-hidden />
            : t(observed === null || state.system.error !== null ? 'unknown' : observed[permission] ? 'granted' : 'missing')}</span>
          <div className={css.actions}>
            {loading ? <span className={css.buttonPlaceholder} aria-hidden />
              : observed?.[permission] === false && <Button size="sm" variant="primary" disabled={busy} onClick={() => { props.request(permission) }}>{t('request')}</Button>}
            <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => { props.openSettings(permission) }}>{t('settings')}</Button>
          </div>
        </div>)}
      </div>
      {observed !== null && (!observed.accessibility || !observed.screenRecording) && <p>
        {t(application === undefined ? 'permissionHintUnknown' : 'permissionHint')}
      </p>}
    </section>
    <section className={css.panel} aria-label={t('applicationsTitle')}>
      <h3>{t('applicationsTitle')}</h3>
      <div className={css.card}>
        {(['applications', 'icons'] as const).map(key => !transitioning && !state[key].busy && state[key].error !== null && <div className={css.notice} role="alert" key={key}>
          <span className={css.error}>{t(key === 'applications' ? 'applicationsFailed' : 'iconsFailed', { message: state[key].error })}</span>
          <Button size="sm" variant="outline" onClick={refresh}>{t('retry')}</Button>
        </div>)}
        {apps === null ? <div className={css.emptyState}><span className={css.appsPlaceholder} aria-hidden /></div> : <>
          {apps.allowedApps.length === 0 && apps.blockedApps.length === 0 && <p className={css.emptyState}>{t('noApps')}</p>}
          {apps.allowedApps.length > 0 && <Applications title={t('allowedApps')} apps={apps.allowedApps} icons={state.icons.value}
            onAction={props.revoke} label={t('revoke')} disabled={appsBusy || !apps.persistentAvailable} />}
          {apps.blockedApps.length > 0 && <Applications title={t('blockedApps')} apps={apps.blockedApps} icons={state.icons.value}
            onAction={props.retryApproval} label={t('retryApproval')} disabled={appsBusy} />}
        </>}
      </div>
    </section>
  </div>
}

/**
 * @param props Permission observation and activation navigation callbacks.
 * @returns Setup guidance when system permissions need attention.
 */
export function PermissionSetup({ t, setActive, useCuaPermissions, onDismiss, onOpenDetails }: PermissionSetupProps) {
  const state = useCuaPermissions(value => value.system)
  useEffect(() => { setActive(true) }, [setActive])
  const ready = state.value !== null && state.error === null
    && state.value.accessibility && state.value.screenRecording
  useEffect(() => { if (ready && !state.busy) onDismiss() }, [ready, state.busy, onDismiss])
  return <Modal open={!ready && (state.value !== null || (!state.busy && state.error !== null))}
    title={t('setupTitle')} closeLabel={t('close')} onClose={onDismiss}
    footer={<>
      <Button variant="ghost" onClick={onDismiss}>{t('later')}</Button>
      <Button variant="primary" data-modal-autofocus onClick={onOpenDetails}>{t('openSetup')}</Button>
    </>}>
    <p>{t(state.error === null ? 'setupBody' : 'setupQueryFailed')}</p>
  </Modal>
}

/** @param props Shared operation outcome, independent of page lifetime. @returns The existing global toast presentation. */
export function PermissionToast(props: PermissionProps) {
  const toast = props.useCuaPermissions(value => value.toast)
  if (!toast) return null
  return <Toast key={toast.id} text={toast.kind === 'failed' ? props.t('failed', { message: toast.message }) : props.t(toast.kind)}
    {...toast.kind === 'revoked' ? { tone: 'success' as const } : {}} onDone={props.dismissToast} />
}
