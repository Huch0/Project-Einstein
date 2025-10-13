import ChatPanel from '@/components/chat/chat-panel';
import ControlPane from '@/components/simulation/control-pane';
import SimulationWrapper from '@/components/simulation/simulation-wrapper';

export default function DashboardPage() {
    return (
        <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-2">
            <div className="flex h-full min-h-0 flex-col border-r">
                <ChatPanel />
            </div>
            <div className="grid h-full min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="min-h-0 border-b">
                    <SimulationWrapper />
                </div>
                <div className="min-h-0 overflow-auto">
                    <ControlPane />
                </div>
            </div>
        </div>
    );
}
