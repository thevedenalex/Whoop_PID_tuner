import Home from './pages/Home'
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  return (
    <>
      <Home />
      <Toaster theme="dark" position="bottom-right" richColors />
    </>
  )
}
