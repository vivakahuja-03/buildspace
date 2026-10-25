import { Component, type ErrorInfo, type ReactNode } from 'react';
/** Keeps a rendering bug on one page from blanking the whole app; shows a safe message (no stack traces or data). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error('BuildSpace: render error', e.name, info.componentStack?.split('\n')[1]?.trim()); }
  render() { return this.state.failed ? <div role="alert" className="m-4 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900"><p className="font-semibold">This page hit an unexpected error.</p><p className="mt-1">Your saved data is unchanged.</p><button className="mt-2 rounded border border-red-400 px-3 py-1" onClick={() => this.setState({ failed: false })}>Try again</button></div> : this.props.children; }
}
