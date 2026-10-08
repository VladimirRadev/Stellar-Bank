import { Main } from './app/index'
import { Providers } from './shell/Providers'
import { Shell } from './shell/Shell'

export default function App() {
  return (
    <Providers>
      <Shell>
        <Main />
      </Shell>
    </Providers>
  )
}
