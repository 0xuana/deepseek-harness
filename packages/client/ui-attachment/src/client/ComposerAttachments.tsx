import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps, ComposerImageAttachment,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconCloseFillRegular, IconRefreshOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { FileCard } from '../FileCard.tsx'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { attachmentRailLabels, dropOverlayLabels, fileCardLabels, lightboxLabels } from './labels.ts'
import { installDocumentDropEvents } from './drop-events.ts'
import css from './ComposerAttachments.module.css'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** The owner share and locale seat the attachment rail reads from its slot props. */
type ComposerAttachmentsInput = Pick<ComposerAttachmentsProps,
  | 'attachments' | 'canAcceptDrop' | 'onAddFiles' | 'onRemoveAttachment' | 'uploads' | 'onRetryFile'
  | 'uploadFailureText' | 'dropLimits' | 't'>

/** Draft image previews, pending-file cards, drop target, and original-image preview. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddFiles, onRemoveAttachment, uploads, onRetryFile, uploadFailureText, dropLimits, t,
}: ComposerAttachmentsInput) {
  const [preview, setPreview] = useState<ComposerImageAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])
  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    return installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive)
  }, [canAcceptDrop, onAddFiles])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    attachment,
  })), [attachments])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            renderItem={(item) => {
              const attachment = item.attachment
              if (attachment.kind === 'file') {
                const upload = uploads[attachment.id]
                return (
                  <FileCard
                    name={attachment.file.name || t('file.label')}
                    bytes={attachment.file.size}
                    state={upload === undefined || upload.status === 'uploading'
                      ? 'uploading'
                      : upload.status === 'ready' ? 'ready' : 'error'}
                    {...upload?.status === 'uploading' && upload.total !== undefined && upload.total > 0
                      ? { progress: upload.loaded / upload.total }
                      : {}}
                    labels={fileCardLabels(t, attachment.file.name)}
                    onRemove={() => { onRemoveAttachment(attachment.id) }}
                    onRetry={() => { onRetryFile(attachment.id) }}
                  />
                )
              }
              // An uploading image shows its progress; a failed upload turns the thumbnail into its retry
              // control, except one the Host refused, which shows why and leaves removal as the way out.
              const upload = uploads[attachment.id]
              const name = attachment.file.name || t('image.pending')
              const refusal = upload?.status === 'error' && upload.reason !== undefined
                ? uploadFailureText(upload.reason)
                : undefined
              return (
                <div className={css.imageItem}>
                  {refusal !== undefined
                    ? (
                      <div
                        className={`${css.thumbnail} ${css.thumbnailFailed} ${css.thumbnailRefused}`}
                        role="img"
                        aria-label={refusal}
                        title={refusal}
                      >
                        <img src={attachment.previewUrl} alt="" />
                        <span className={css.failureGlyph} aria-hidden><IconWarningOutlineRegular size={16} /></span>
                      </div>
                    )
                    : upload?.status === 'error'
                      ? (
                        <button
                          type="button"
                          className={`${css.thumbnail} ${css.thumbnailFailed}`}
                          title={t('file.uploadFailed')}
                          aria-label={t('file.retry', { name })}
                          onClick={() => { onRetryFile(attachment.id) }}
                        >
                          <img src={attachment.previewUrl} alt="" />
                          <span className={css.failureGlyph} aria-hidden><IconRefreshOutlineRegular size={16} /></span>
                        </button>
                      )
                      : (
                        <button
                          type="button"
                          className={css.thumbnail}
                          title={t('image.openOriginal')}
                          aria-busy={upload?.status === 'uploading'}
                          onClick={() => { setPreview(attachment) }}
                        >
                          <img src={attachment.previewUrl} alt={name} />
                        </button>
                      )}
                  {upload?.status === 'uploading' && (
                    <span className={css.progressTrack} aria-hidden>
                      <span
                        className={css.progressBar}
                        style={upload.total === undefined || upload.total <= 0
                          ? undefined
                          : { width: `${String(Math.min(1, upload.loaded / upload.total) * 100)}%` }}
                      />
                    </span>
                  )}
                  <button
                    type="button"
                    className={css.remove}
                    aria-label={t('image.remove', { name })}
                    onClick={() => { onRemoveAttachment(attachment.id) }}
                  >
                    <IconCloseFillRegular size={12} />
                  </button>
                </div>
              )
            }}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
