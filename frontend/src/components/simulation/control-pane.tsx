import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ParametersPanel from './parameters-panel';
import AnalysisPanel from './analysis-panel';

export default function ControlPane() {
  return (
    <div className="p-4 md:p-6 h-full">
      <Tabs defaultValue="parameters" className="h-full flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>
        <TabsContent value="parameters" className="flex-1 mt-4 min-h-0">
          <ParametersPanel />
        </TabsContent>
        <TabsContent value="analysis" className="flex-1 mt-4 min-h-0">
          <AnalysisPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
