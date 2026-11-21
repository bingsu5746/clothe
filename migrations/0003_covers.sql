-- 3차: 코디 대표 사진(콜라주 그림) + 스크랩 종류
-- 이 파일은 Worker가 첫 요청 때 직접 적용한다 (worker/lib/migrate.ts). 이미 있는 컬럼은 건너뛴다.

-- 저장한 코디의 대표 사진 (피팅룸 콜라주 보드에서 만든 그림). 없으면 NULL → 옷 사진 묶음으로 보여 준다.
ALTER TABLE outfits ADD COLUMN cover_image_key TEXT;

-- 스크랩 종류: photo = 밖에서 가져온 코디 사진(열면 AI가 자동 분석), collage = 콜라주 보드에서 만든 그림(자동 분석하지 않음)
ALTER TABLE inspirations ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo';

-- 예전 버전은 콜라주를 이 메모로 스크랩에 저장했다 → collage로 표시해서 열 때마다 AI를 부르지 않게
UPDATE inspirations SET kind = 'collage' WHERE note = '콜라주 보드에서 만든 코디';
