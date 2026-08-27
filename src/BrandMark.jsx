import markUrl from './assets/quotegen-mark.png'

/** QuoteGen ribbon “Q” mark — used in nav, auth, and chrome. */
export default function BrandMark({ size = 32, className = '', style, alt = 'QuoteGen' }) {
  const px = typeof size === 'number' ? size : undefined
  return (
    <img
      src={markUrl}
      alt={alt}
      width={px}
      height={px}
      className={className}
      style={{
        width: px ?? size,
        height: px ?? size,
        objectFit: 'contain',
        display: 'block',
        flex: '0 0 auto',
        ...style
      }}
      draggable={false}
    />
  )
}

export { markUrl as brandMarkUrl }
