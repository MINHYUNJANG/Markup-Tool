import './globals.css'

export const metadata = {
  title: 'Markup Tool',
  description: '웹 페이지 크롤링 및 자동 마크업 도구',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
