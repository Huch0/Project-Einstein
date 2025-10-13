import { Header } from '@/components/layout/header';
import { SimulationProvider } from '@/simulation/SimulationContext';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex h-screen w-full flex-col overflow-hidden">
            <Header />
            <SimulationProvider>
                <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/40">
                    {children}
                </main>
          </SimulationProvider>
    </div>
    );
}
