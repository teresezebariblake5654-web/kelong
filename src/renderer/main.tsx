import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Failed to find the root element');
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Provider store={store}>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </Provider>
    </React.StrictMode>
  );
} catch (error) {
    console.error('Failed to render the app:', error);
}
