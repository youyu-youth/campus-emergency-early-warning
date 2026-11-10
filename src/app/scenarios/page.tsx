import { PageHeader } from "@/components/shell/page-header";
import { ScenariosConsole } from "@/components/scenarios/scenarios-console";

export default function ScenariosPage() {
  return (
    <>
      <PageHeader
        title="事件库管理"
        description="维护可选的模拟事件:内置模板锁定,自定义事件增删改"
      />
      <ScenariosConsole />
    </>
  );
}
