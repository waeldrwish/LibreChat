import { useCallback, useState } from 'react';
import { useToastContext } from '@librechat/client';
import type { SharePointFile, SharePointBatchProgress } from '~/data-provider/Files';
import { useSharePointBatchDownload } from '~/data-provider/Files';
import useSharePointToken from './useSharePointToken';
import { useLocalize } from '~/hooks';

interface UseSharePointDownloadProps {
  onFilesDownloaded?: (files: File[]) => void | Promise<void>;
  onError?: (error: Error) => void;
}

interface UseSharePointDownloadReturn {
  downloadSharePointFiles: (files: SharePointFile[]) => Promise<File[]>;
  isDownloading: boolean;
  downloadProgress: SharePointBatchProgress | null;
  error: string | null;
}

export default function useSharePointDownload({
  onFilesDownloaded,
  onError,
}: UseSharePointDownloadProps = {}): UseSharePointDownloadReturn {
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const [downloadProgress, setDownloadProgress] = useState<SharePointBatchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { token, refetch: refetchToken } = useSharePointToken({
    enabled: false,
    purpose: 'Download',
  });

  const batchDownloadMutation = useSharePointBatchDownload();

  const downloadSharePointFiles = useCallback(
    async (files: SharePointFile[]): Promise<File[]> => {
      if (!files || files.length === 0) {
        throw new Error('No files provided for download');
      }

      setError(null);
      setDownloadProgress({ completed: 0, total: files.length, failed: [] });

      try {
        let accessToken = token?.access_token;
        if (!accessToken) {
          showToast({
            message: localize('com_files_sharepoint_token_fetching'),
            status: 'info',
            duration: 2000,
          });

          const tokenResult = await refetchToken();
          accessToken = tokenResult.data?.access_token;

          if (!accessToken) {
            throw new Error(localize('com_files_sharepoint_token_failed'));
          }
        }

        showToast({
          message: localize('com_files_sharepoint_downloading', { count: files.length }),
          status: 'info',
          duration: 3000,
        });

        const downloadedFiles = await batchDownloadMutation.mutateAsync({
          files,
          accessToken,
          onProgress: (progress) => {
            setDownloadProgress(progress);

            if (files.length > 5 && progress.completed % 3 === 0) {
              showToast({
                message: localize('com_files_sharepoint_download_progress', {
                  completed: progress.completed,
                  total: progress.total,
                }),
                status: 'info',
                duration: 1000,
              });
            }
          },
        });

        if (downloadedFiles.length > 0) {
          const failedCount = files.length - downloadedFiles.length;
          const successMessage =
            failedCount > 0
              ? localize('com_files_sharepoint_download_partial', {
                  downloaded: downloadedFiles.length,
                  total: files.length,
                  failed: failedCount,
                })
              : localize('com_files_sharepoint_download_success', {
                  count: downloadedFiles.length,
                });

          showToast({
            message: successMessage,
            status: failedCount > 0 ? 'warning' : 'success',
            duration: 4000,
          });

          if (onFilesDownloaded) {
            await onFilesDownloaded(downloadedFiles);
          }
        }

        setDownloadProgress(null);
        return downloadedFiles;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown download error';
        setError(errorMessage);

        showToast({
          message: localize('com_files_sharepoint_download_failed', { error: errorMessage }),
          status: 'error',
          duration: 5000,
        });

        if (onError) {
          onError(error instanceof Error ? error : new Error(errorMessage));
        }

        setDownloadProgress(null);
        throw error;
      }
    },
    [token, showToast, localize, batchDownloadMutation, onFilesDownloaded, onError, refetchToken],
  );

  return {
    downloadSharePointFiles,
    isDownloading: batchDownloadMutation.isLoading,
    downloadProgress,
    error,
  };
}
