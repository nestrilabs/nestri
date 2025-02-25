import { type Component, type JSX } from 'solid-js'

// import SshComponent from '@components/ssh'

// type ShopProps = { apiUrl: string } & JSX.HTMLAttributes<HTMLDivElement>

const ConsoleComponent: Component = () => {
    return (
        <div class="bg-red-500 size-full text-4xl">
            Hello There
        </div>
    )
}

export default ConsoleComponent