import { Header } from '@/components/layout/header';
import { SimulationProvider } from '@/simulation/SimulationContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <SimulationProvider>
        <main className="flex flex-1 flex-col bg-muted/40">{children}</main>
      </SimulationProvider>
    </div>
  );
}
