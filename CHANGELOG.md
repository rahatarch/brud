# Changelog

All notable changes to **Brud Code** are documented in this file. This project adheres to
[Semantic Versioning](https://semver.org/) and follows the
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.

## [0.1.2] - 2026-09-21

### Added
- New Settings page with workspace boundary and tool allow-list controls
- New landing page with interactive elements
- My Prompts feature with versioning and dynamic fields
- Operation metadata now shown in History panel and results

### Changed
- Search and read operations no longer limited to hardcoded result caps
- Improved result summaries throughout the interface
- Get Started page redesigned with visual walkthrough and screenshots
- Updated application icon
- Improved Settings user interface

### Fixed
- Snapshots are no longer corrupted when follow-on operations are applied
- Diff Preview panel stays open after executing a single file
- Session auto-completes when all files in a batch have been reviewed
- Read operations now validate input correctly
- Results panel displays all operation results reliably

### Security
- Block terminal commands that attempt to escape the workspace

## [0.1.1] - 2026-09-10

### Fixed
- Restore sidebar icon in the published extension

## [0.1.0] - 2026-09-10

### Added
- Create, delete, rename, move, copy, and append files and directories
- Apply bulk changes to thousands of files with a single block
- Search files by name, glob pattern, or file extension
- Extract project structure as token-efficient JSON for AI tools
- Get codebase metadata including file count, folder count, and density
- Read files with automatic import following
- Run terminal commands with single, sequential, parallel, or conditional execution
- Interactive terminal support for CLI wizards and prompts
- Complete session history with recording and snapshots
- Revert individual operations or roll back entire sessions
- 7-day trash protection with full restore capability
- Audit log for all deletion operations
- Unified Results Panel showing all operation results
- Diff Preview with per-file execution control
- Prompt Library with ready-made prompts for AI chatbots
- GET_TOOL_INFO for AI tool discovery
- Workspace security with dangerous command blocking
- Friendly chat interface with structured reports
- AI output cleaner to remove extraneous AI formatting
- Support for multiple output formats
- Apply changes to all occurrences of a pattern
- Syntax validation to catch errors before applying
- Template library with reusable code templates
- Copy Summary button for token-efficient AI feedback
- Verified benchmarks on 384K LOC codebase (1,000 files, 467 patches, 467 appends, revert/restore)

### Changed
- Rebranded from Akkhar Code Patcher to Brud Code
- Improved user interface with professional design
- Native scrolling and cleaner layout