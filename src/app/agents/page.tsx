import { AgentsConsole } from "@/components/agents/agents-console";
import { PageHeader } from "@/components/shell/page-header";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="智能体协作调度"
        description="五类智能体的协作关系图与交接日志"
      />
      <AgentsConsole />
    </>
  );
}
