import ChatPanel from '@/components/chat/chat-panel';
import ControlPane from '@/components/simulation/control-pane';
import SimulationWrapper from '@/components/simulation/simulation-wrapper';

export default function DashboardPage() {
  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 h-[calc(100vh-4rem)]">
      <div className="flex flex-col h-full border-r">
        <ChatPanel />
      </div>
      <div className="grid grid-rows-2 h-full">
        <div className="border-b">
          <SimulationWrapper />
        </div>
        <div>
          <ControlPane />
        </div>
      </div>
    </div>
  );
}
