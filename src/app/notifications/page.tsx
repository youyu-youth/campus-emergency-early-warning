import Link from "next/link";
import { Megaphone } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="通知发布中心"
        description="面向师生与家长的通知生成、人工确认与模拟分发记录"
      />
      <EmptyState
        icon={Megaphone}
        title="通知中心建设中"
        description="推演中的通知草稿将在此确认并模拟分发，所有通知均带「模拟演练」水印，不向真实渠道发送。"
        action={
          <Link href="/" className="text-sm font-medium text-primary hover:brightness-110">
            返回综合指挥台
          </Link>
        }
        className="flex-1"
      />
    </>
  );
}
