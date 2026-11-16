import { ListGroup, ListRow, Page } from "../components/ui";
import { moreNav } from "../nav";

/** 모바일 탭 바의 "더보기": 탭에 올라가지 않은 목적지 목록 */
export default function More() {
  return (
    <Page title="더보기" width="narrow">
      <ListGroup>
        {moreNav().map((n) => {
          const Icon = n.icon;
          return <ListRow key={n.id} to={n.to} icon={<Icon size={22} />} title={n.label} subtitle={n.description} />;
        })}
      </ListGroup>
    </Page>
  );
}
