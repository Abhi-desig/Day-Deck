import { useEffect, useState } from 'react'
import { PROCESS_GROUPS, type ResolvedProcess } from '@shared/processes'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/error'
import { ProcessBox } from './ProcessBox'

/**
 * The prompt desk: every AI process in the app, with its prose editable.
 *
 * Grouped by area rather than listed flat, so ten boxes read as four groups —
 * and because "which of these runs when I press that button" is the question
 * this panel exists to answer, and the area is most of that answer.
 *
 * What is on offer here is only ever the prose: the opening instruction and the
 * rules. The data blocks, the schema and the parser stay code, because they are
 * the contract between the prompt and the app rather than a preference.
 */
export function Processes({ onError }: { onError(message: string): void }) {
  const [processes, setProcesses] = useState<ResolvedProcess[]>([])

  useEffect(() => {
    api.settings
      .processes()
      .then(setProcesses)
      .catch((err) => onError(errorMessage(err)))
  }, [onError])

  const replace = (next: ResolvedProcess): void =>
    setProcesses((all) => all.map((p) => (p.id === next.id ? next : p)))

  const byId = new Map(processes.map((p) => [p.id, p]))

  return (
    <section className="mb-4 rounded-xl border border-line-soft bg-surface/70 p-5">
      <h2 className="text-[14px] tracking-[-0.01em]">Process prompts</h2>
      <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-faint">
        Every AI call this app makes, and the words behind it. You can change the
        instruction and the rules; the data each prompt is built around — the
        brief, the board, the cast, the schema the answer comes back on — stays
        code, because that is the part the parser depends on. Every number is
        clamped on save, and Reset puts a process back exactly as it shipped.
      </p>

      <div className="mt-4 space-y-4">
        {PROCESS_GROUPS.map((group) => {
          const boxes = group.ids.flatMap((id) => {
            const process = byId.get(id)
            return process ? [process] : []
          })
          if (boxes.length === 0) return null

          return (
            <div key={group.id}>
              <h3 className="pb-1.5 text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
                {group.label}
              </h3>
              <div className="space-y-1.5">
                {boxes.map((process) => (
                  <ProcessBox
                    key={process.id}
                    process={process}
                    onSave={(override) => {
                      api.settings
                        .setProcess(process.id, override)
                        .then(replace)
                        .catch((err) => onError(errorMessage(err)))
                    }}
                    onReset={() => {
                      api.settings
                        .resetProcess(process.id)
                        .then(replace)
                        .catch((err) => onError(errorMessage(err)))
                    }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
