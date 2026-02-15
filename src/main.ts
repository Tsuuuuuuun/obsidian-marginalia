import {Editor, MarkdownView, Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, SideCommentSettings, SideCommentSettingTab} from "./settings";
import {CommentStore} from "./storage/CommentStore";
import {VaultEventHandler} from "./events/VaultEventHandler";
import {resolveAnchor, findHeadingContext, extractContext} from "./anchoring/TextQuoteSelector";
import {CommentPopover} from "./editor/PopoverExtension";
import {createCommentGutter, updateCommentPositions} from "./editor/GutterExtension";
import {CommentPanelView, VIEW_TYPE_COMMENT_PANEL} from "./views/CommentPanelView";
import {CommentModal} from "./views/CommentModal";
import type {CommentTarget, ResolvedAnchor} from "./types";
import type {Extension} from "@codemirror/state";

export default class SideCommentPlugin extends Plugin {
	settings: SideCommentSettings;
	store: CommentStore;
	private popover: CommentPopover;
	private gutterExtension: Extension;
	private resolveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	async onload() {
		await this.loadSettings();

		this.store = new CommentStore(this.app.vault.adapter, this.manifest.dir ?? '');
		this.store.setAnchorResolver(resolveAnchor);
		await this.store.initialize();

		this.popover = new CommentPopover(this);

		new VaultEventHandler(this, this.store).registerEvents();

		// Register side panel view
		this.registerView(VIEW_TYPE_COMMENT_PANEL, (leaf) => new CommentPanelView(leaf, this));

		// Register CM6 gutter extension
		this.gutterExtension = createCommentGutter(this);
		this.registerEditorExtension(this.gutterExtension);

		// Commands
		this.addCommand({
			id: 'add-comment',
			name: 'Add comment to selection',
			editorCheckCallback: (checking, editor, view) => {
				const hasSelection = editor.somethingSelected();
				if (checking) return hasSelection;
				if (hasSelection && view instanceof MarkdownView && view.file) {
					this.addCommentFromSelection(editor, view);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'open-comment-panel',
			name: 'Open comment panel',
			callback: () => {
				void this.activatePanel();
			},
		});

		this.addCommand({
			id: 'next-comment',
			name: 'Go to next comment',
			editorCallback: (editor, view) => {
				if (view.file) {
					void this.navigateComment(editor, view.file.path, 'next');
				}
			},
		});

		this.addCommand({
			id: 'prev-comment',
			name: 'Go to previous comment',
			editorCallback: (editor, view) => {
				if (view.file) {
					void this.navigateComment(editor, view.file.path, 'prev');
				}
			},
		});

		// Context menu
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (editor.somethingSelected() && view.file) {
					menu.addItem((item) => {
						item.setTitle('Add comment')
							.setIcon('message-square')
							.onClick(() => {
								this.addCommentFromSelection(editor, view as MarkdownView);
							});
					});
				}
			})
		);

		// Ribbon icon
		this.addRibbonIcon('message-square', 'Open comment panel', () => {
			void this.activatePanel();
		});

		// Settings tab
		this.addSettingTab(new SideCommentSettingTab(this.app, this));

		// Debounced anchor re-resolve on document change
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file.path.endsWith('.md')) {
					this.scheduleResolve(file.path);
				}
			})
		);

		// Update gutter on active leaf change
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				void this.updateGutterForActiveFile();
			})
		);
	}

	onunload() {
		this.popover?.destroy();
		if (this.resolveDebounceTimer) clearTimeout(this.resolveDebounceTimer);
		void this.store?.flushAll();
	}

	refreshPanel(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof CommentPanelView) {
				void view.refresh();
			}
		}
	}

	updateGutterEffects(): void {
		void this.updateGutterForActiveFile();
	}

	scrollPanelToComment(commentId: string): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof CommentPanelView) {
				view.scrollToComment(commentId);
				return;
			}
		}
		// If panel not open, open it then scroll
		void this.activatePanel().then(() => {
			const newLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
			for (const leaf of newLeaves) {
				const view = leaf.view;
				if (view instanceof CommentPanelView) {
					// Delay to let panel render
					setTimeout(() => view.scrollToComment(commentId), 200);
					return;
				}
			}
		});
	}

	showPopover(anchor: HTMLElement, commentIds: string[]): void {
		if (this.settings.showGutterIcons) {
			void this.popover?.show(anchor, commentIds);
		}
	}

	hidePopover(): void {
		this.popover?.scheduleHide();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SideCommentSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addCommentFromSelection(editor: Editor, view: MarkdownView): void {
		const selectedText = editor.getSelection();
		if (!selectedText || !view.file) return;

		const cursor = editor.getCursor('from');
		const docText = editor.getValue();
		const offset = editor.posToOffset(cursor);

		const target: CommentTarget = {
			exact: selectedText,
			prefix: extractContext(docText, offset - 50, 50),
			suffix: extractContext(docText, offset + selectedText.length, 50),
			headingContext: findHeadingContext(docText, offset) ?? undefined,
			lineHint: cursor.line,
		};

		const filePath = view.file.path;

		new CommentModal(this.app, (body) => {
			void this.store.addComment(filePath, body, target).then(() => {
				void this.updateGutterForActiveFile();
				this.refreshPanel();
			});
		}).open();
	}

	private async activatePanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
		if (existing.length > 0) {
			void this.app.workspace.revealLeaf(existing[0]!);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({type: VIEW_TYPE_COMMENT_PANEL, active: true});
			void this.app.workspace.revealLeaf(leaf);
		}
	}

	private async navigateComment(editor: Editor, filePath: string, direction: 'next' | 'prev'): Promise<void> {
		const docText = editor.getValue();
		const anchors = await this.store.resolveAnchors(filePath, docText, this.settings.fuzzyMatchThreshold);

		if (anchors.size === 0) return;

		const sorted = [...anchors.entries()].sort((a, b) => a[1].from - b[1].from);
		const currentOffset = editor.posToOffset(editor.getCursor());

		let target: [string, ResolvedAnchor] | undefined;

		if (direction === 'next') {
			target = sorted.find(([, a]) => a.from > currentOffset);
			if (!target) target = sorted[0]; // Wrap around
		} else {
			target = [...sorted].reverse().find(([, a]) => a.from < currentOffset);
			if (!target) target = sorted[sorted.length - 1]; // Wrap around
		}

		if (target) {
			const pos = editor.offsetToPos(target[1].from);
			editor.setCursor(pos);
			editor.scrollIntoView(
				{from: pos, to: editor.offsetToPos(target[1].to)},
				true
			);
		}
	}

	private scheduleResolve(filePath: string): void {
		if (this.resolveDebounceTimer) clearTimeout(this.resolveDebounceTimer);
		this.resolveDebounceTimer = setTimeout(() => {
			this.resolveDebounceTimer = null;
			void this.resolveAndUpdate(filePath);
		}, 400);
	}

	private async resolveAndUpdate(filePath: string): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.path !== filePath) return;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		const docText = mdView.editor.getValue();
		const anchors = await this.store.resolveAnchors(filePath, docText, this.settings.fuzzyMatchThreshold);
		this.dispatchGutterUpdate(anchors);
		this.refreshPanel();
	}

	private async updateGutterForActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || !file.path.endsWith('.md')) return;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		const docText = mdView.editor.getValue();
		const anchors = await this.store.resolveAnchors(file.path, docText, this.settings.fuzzyMatchThreshold);
		this.dispatchGutterUpdate(anchors);
	}

	private dispatchGutterUpdate(anchors: Map<string, ResolvedAnchor>): void {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		// Access CM6 EditorView through Obsidian's editor
		const editorObj: Record<string, unknown> = mdView.editor as unknown as Record<string, unknown>;
		const cmEditor = editorObj['cm'] as {dispatch: (spec: {effects: unknown}) => void} | undefined;
		if (!cmEditor) return;

		const infos = [...anchors.entries()].map(([commentId, anchor]) => ({
			line: anchor.line,
			commentId,
			count: 1,
		}));

		cmEditor.dispatch({
			effects: updateCommentPositions.of(infos),
		});
	}
}
