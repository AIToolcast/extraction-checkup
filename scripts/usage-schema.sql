-- Anonymous, first-party tool events. Never add input, report, network or device data.
CREATE TABLE IF NOT EXISTS tool_events (
  day TEXT NOT NULL CHECK (length(day) = 10 AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  tool TEXT NOT NULL CHECK (tool = 'extraction-checkup'),
  session TEXT NOT NULL CHECK (length(session) = 36),
  event TEXT NOT NULL CHECK (event IN ('arrival', 'start', 'complete', 'copy', 'export', 'practice_download')),
  source TEXT NOT NULL CHECK (source IN ('direct', 'x', 'github', 'google', 'bing', 'other')),
  campaign TEXT NOT NULL CHECK (campaign IN ('none', 'free-tool-launch', 'newsroom')),
  audience TEXT NOT NULL CHECK (audience IN ('reader', 'qa')),
  PRIMARY KEY (day, tool, session, event)
) WITHOUT ROWID;
