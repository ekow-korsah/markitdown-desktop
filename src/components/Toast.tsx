interface Props {
  message: string | null
}

export default function Toast({ message }: Props) {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
      <p className="card-shadow rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-medium text-ink">
        {message}
      </p>
    </div>
  )
}
