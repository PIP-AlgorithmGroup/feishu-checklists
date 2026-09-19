BEGIN;

CREATE TABLE IF NOT EXISTS checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_key varchar(100) NOT NULL UNIQUE,
  title varchar(80) NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  processed_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(processed_event_ids) = 'array'),
  open_message_id text,
  open_chat_id text,
  version integer NOT NULL DEFAULT 1,
  _created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  _updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  CONSTRAINT checklist_binding_pair CHECK (
    (open_message_id IS NULL) = (open_chat_id IS NULL)
  )
);

COMMENT ON COLUMN checklist.items IS '@type { unknown }';
COMMENT ON COLUMN checklist.processed_event_ids IS '@type { string[] }';

ALTER TABLE checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_bypass_policy ON checklist
  TO service_role USING (true);

CREATE POLICY "修改全部数据" ON checklist
  AS PERMISSIVE FOR ALL TO authenticated USING (true);

CREATE POLICY "查看全部数据" ON checklist
  AS PERMISSIVE FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "修改本人数据" ON checklist
  AS PERMISSIVE FOR ALL TO authenticated USING (
    (current_setting('app.user_id'::text) = ANY (ARRAY[]::text[]))
    AND (current_setting('app.user_id'::text) = ((_created_by).user_id)::text)
  );

COMMIT;
