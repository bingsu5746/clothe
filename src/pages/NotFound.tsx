import { SearchIcon } from "../components/icons";
import { ButtonLink, Empty, Page } from "../components/ui";

/** 없는 주소 (예전 링크, 잘못 입력한 주소) */
export default function NotFound() {
  return (
    <Page title="페이지를 찾을 수 없어요" width="narrow">
      <Empty icon={<SearchIcon size={26} />} title="없는 화면이에요" action={<ButtonLink to="/" variant="primary">오늘로 가기</ButtonLink>}>
        주소가 바뀌었거나 잘못 입력됐어요.
      </Empty>
    </Page>
  );
}
