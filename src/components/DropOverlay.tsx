/** Shown while files are dragged over the window: one clear, unambiguous moment. */
export default function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-canvas/70">
      <div className="absolute inset-2 rounded-[16px] border-2 border-accent" />
      <p className="card-shadow rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-canvas">
        Drop to convert
      </p>
    </div>
  )
}
