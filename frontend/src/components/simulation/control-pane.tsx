import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ParametersPanel from './parameters-panel';
import CodePanel from './code-panel';

export default function ControlPane() {
  return (
    <div className="p-4 md:p-6 h-full">
      <Tabs defaultValue="parameters" className="h-full flex flex-col">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
        </TabsList>
        <TabsContent value="parameters" className="flex-1 mt-4">
          <ParametersPanel />
        </TabsContent>
        <TabsContent value="code" className="flex-1 mt-4">
          <CodePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
