import { useEffect, useMemo, useRef } from 'react'
import { MotionConfig, motion } from 'motion/react'
import { SECTIONS } from '@shared/types'
import { useDeck } from './store/useDeck'
import { useProjects } from './store/useProjects'
import { useShell } from './store/useShell'
import { useStickers } from './store/useStickers'
import { CommandPalette } from './components/shell/CommandPalette'
import { DataPanel } from './components/shell/DataPanel'
import { SideNav } from './components/shell/SideNav'
import { TransitionPanel } from './components/motion-primitives/TransitionPanel'
import { Today } from './sections/Today'
import { Projects } from './sections/Projects'
import { GoalsAdmin } from './sections/GoalsAdmin'
import { Tracker } from './sections/Tracker'
import { Stickers } from './sections/Stickers'

export function App() {
  // Section lives in the store rather than here, so the command palette can
  // navigate and then hand an instruction to a section that has not mounted yet.
  const section = useShell((s) => s.section)
  const go = useShell((s) => s.go)

  const index = SECTIONS.indexOf(section)
  const lastIndex = useRef(index)

  const ready = useDeck((s) => s.ready)
  const error = useDeck((s) => s.error)
  const init = useDeck((s) => s.init)
  const loadStickers = useStickers((s) => s.load)

  useEffect(() => {
    void init()
  }, [init])

  // Loaded at the shell rather than in the Stickers section, because day cards
  // render the notes pinned to them and must not depend on the wall having been
  // visited first.
  useEffect(() => {
    void loadStickers()
  }, [loadStickers])

  const direction = index >= lastIndex.current ? 1 : -1
  useEffect(() => {
    lastIndex.current = index
  }, [index])

  // Opening a workspace is a navigation, and it can be triggered from a day
  // card in the Today section. The projects store is the single place that
  // knows a workspace is open, so the shell follows it rather than every
  // caller having to remember to switch sections too.
  const openProjectId = useProjects((s) => s.openId)
  useEffect(() => {
    if (openProjectId) go('projects')
  }, [openProjectId, go])

  const panels = useMemo(
    () => [
      <Today key="today" />,
      <Projects key="projects" />,
      <GoalsAdmin key="goals" />,
      <Tracker key="tracker" />,
      <Stickers key="stickers" />
    ],
    []
  )

  return (
    // reducedMotion="user" makes Motion drop transform/layout animations
    // system-wide when the OS asks for it, without a prop on every component.
    <MotionConfig reducedMotion="user">
      <div className="app-ambient flex h-full w-full text-ink">
        <SideNav active={section} onSelect={go} />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="drag-region h-[52px] shrink-0" />

          {error ? (
            <FatalError message={error} />
          ) : !ready ? (
            <Booting />
          ) : (
            <TransitionPanel
              activeIndex={index}
              direction={direction}
              className="relative flex min-h-0 flex-1 flex-col"
            >
              {panels}
            </TransitionPanel>
          )}
        </main>

        {/* Outside <main> and above everything: these are app chrome, not part
            of any section, and they must survive a section transition. */}
        <CommandPalette />
        <DataPanel />
      </div>
    </MotionConfig>
  )
}

function Booting() {
  return (
    <div className="grid flex-1 place-items-center">
      <motion.div
        animate={{ opacity: [0.25, 0.7, 0.25] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        className="text-[12.5px] text-ink-faint"
      >
        Opening your deck…
      </motion.div>
    </div>
  )
}

function FatalError({ message }: { message: string }) {
  return (
    <div className="grid flex-1 place-items-center px-10">
      <div className="max-w-md text-center">
        <p className="text-[14px] text-ink">Day Deck could not start.</p>
        <p
          data-selectable
          className="mt-2 font-mono text-[12px] leading-relaxed text-ink-faint"
        >
          {message}
        </p>
      </div>
    </div>
  )
}
