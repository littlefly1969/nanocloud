import { useState } from 'react';
import { Link } from 'react-router';
import { OrganizeByDateWizard } from '../components/files/OrganizeByDateWizard';
import { PhotoArchiveExportPanel } from '../components/PhotoArchiveExportPanel';
import { useI18n } from '../i18n';

// Cloud Functions — the dedicated home for operational/bulk tools (previously
// scattered in the file/gallery UI). Professional function cards; each opens or
// links to its tool. Owner-private throughout.
type ActivePanel = 'none' | 'export';

export function CloudFunctionsPage() {
  const { t } = useI18n();
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [panel, setPanel] = useState<ActivePanel>('none');
  const [banner, setBanner] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  return (
    <section className="admin-page cloud-functions">
      <div className="admin-header">
        <h2>{t('cloud.heading')}</h2>
      </div>

      {banner && (
        <div className={banner.tone === 'error' ? 'folder-error' : 'folder-banner'} role="status">
          {banner.text}
        </div>
      )}

      <div className="admin-grid">
        {/* Bulk upload → existing staged/resumable upload flow. */}
        <div className="admin-card cloud-function-card">
          <h3>{t('cloud.bulkUpload')}</h3>
          <p className="muted">{t('cloud.bulkUploadDesc')}</p>
          <Link className="row-action-primary" to="/upload" data-testid="cf-upload">
            {t('cloud.openBulkUpload')}
          </Link>
        </div>

        {/* Organize photos by date → the existing DateTaken organizer wizard. */}
        <div className="admin-card cloud-function-card">
          <h3>{t('cloud.organize')}</h3>
          <p className="muted">{t('cloud.organizeDesc')}</p>
          <button
            type="button"
            className="row-action-primary"
            data-testid="cf-organize"
            onClick={() => setOrganizeOpen(true)}
          >
            {t('cloud.organizeBtn')}
          </button>
        </div>

        {/* Download photo archive → the export panel below. */}
        <div className="admin-card cloud-function-card">
          <h3>{t('cloud.downloadArchive')}</h3>
          <p className="muted">{t('cloud.downloadArchiveDesc')}</p>
          <button
            type="button"
            className="row-action-primary"
            data-testid="cf-export"
            onClick={() => setPanel((p) => (p === 'export' ? 'none' : 'export'))}
          >
            {panel === 'export' ? t('cloud.hideExport') : t('cloud.downloadArchive')}
          </button>
        </div>

        {/* Private Vault — active; links to the Private tab. No counts shown. */}
        <div className="admin-card cloud-function-card">
          <h3>{t('cloud.privateVault')}</h3>
          <p className="muted">{t('cloud.privateVaultDesc')}</p>
          <Link className="row-action-primary" to="/private" data-testid="cf-private-vault">
            {t('cloud.openPrivate')}
          </Link>
        </div>
      </div>

      {panel === 'export' && (
        <div className="cloud-function-detail">
          <h3>{t('cloud.downloadArchive')}</h3>
          <PhotoArchiveExportPanel />
        </div>
      )}

      {organizeOpen && (
        <OrganizeByDateWizard
          currentFolderId={null}
          currentFolderName={t('cloud.allPhotos')}
          selectedFileIds={[]}
          onClose={() => setOrganizeOpen(false)}
          onDone={(message) => {
            setBanner(message);
            setOrganizeOpen(false);
          }}
        />
      )}
    </section>
  );
}
