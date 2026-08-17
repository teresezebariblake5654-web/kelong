import React from 'react';
import { i18nService } from '@/services/i18n';
import { isYoudaoCloudEnabled } from '../../shared/featureFlags';

const PRIVACY_URL = 'https://c.youdao.com/dict/hardware/lobsterai/lobsterai_service.html';

interface PrivacyDialogProps {
  onAccept: () => void;
  onReject: () => void;
}

const PrivacyDialog: React.FC<PrivacyDialogProps> = ({ onAccept, onReject }) => {
  const youdaoCloud = isYoudaoCloudEnabled();
  const handleLinkClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!youdaoCloud || !PRIVACY_URL) return;
    await window.electron.shell.openExternal(PRIVACY_URL);
  };

  const desc = i18nService.t('privacyDialogDesc');
  const linkText = i18nService.t('privacyDialogLinkText');
  const parts = desc.split('{link}');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
      <div className="modal-content w-full max-w-md mx-4 bg-surface rounded-2xl shadow-modal overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-foreground text-center">
            {i18nService.t('privacyDialogTitle')}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-secondary leading-relaxed text-center">
            {parts[0]}
            {youdaoCloud ? (
              <a
                href={PRIVACY_URL}
                onClick={handleLinkClick}
                className="text-primary hover:underline cursor-pointer"
              >
                {linkText}
              </a>
            ) : (
              <span className="text-foreground font-medium">{linkText}</span>
            )}
            {parts[1]}
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAccept}
            className="w-full h-10 rounded-xl text-sm font-medium text-white bg-primary hover:opacity-90 transition-opacity"
          >
            {i18nService.t('privacyDialogAccept')}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="w-full h-10 rounded-xl text-sm font-medium text-secondary hover:text-foreground transition-colors"
          >
            {i18nService.t('privacyDialogReject')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyDialog;
