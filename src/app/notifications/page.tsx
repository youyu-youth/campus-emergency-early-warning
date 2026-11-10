import { NotificationsConsole } from "@/components/notifications/notifications-console";
import { PageHeader } from "@/components/shell/page-header";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="通知发布中心"
        description="面向师生与家长的通知生成、人工确认与模拟分发记录"
      />
      <NotificationsConsole />
    </>
  );
}
