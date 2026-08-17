import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Last-resort UI when a render crash would otherwise leave a blank window.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#f7f8fa] px-6 text-center text-slate-800">
        <h1 className="text-lg font-semibold">界面出错了</h1>
        <p className="max-w-md text-sm text-slate-500">
          {this.state.error.message || '未知渲染错误'}
        </p>
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          onClick={this.reload}
        >
          刷新页面
        </button>
      </div>
    );
  }
}
