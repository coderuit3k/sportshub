"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import VenueImage from "@/components/VenueImage";
import {
  VENUE_PHOTO_CONTENT_TYPES,
  VENUE_PHOTO_MAX_BYTES,
} from "@/lib/venue-photos/policy";

/**
 * "Ảnh sân" section on the owner dashboard (per venue): preview of
 * the photo currently displayed, upload of a replacement, and a
 * revert-to-default action.
 *
 * Upload flow: POST /api/owner/venue-photo/upload returns a presigned
 * R2 PUT URL; the file goes browser → Cloudflare R2 directly (XHR so
 * progress can be shown); then POST /api/owner/venue-photo persists
 * the public URL, which is what makes it the venue's displayed
 * photo. When R2 is not connected yet (uploadsConfigured=false, read
 * server-side on the owner page), the section renders an explanatory
 * disabled state instead of a broken uploader.
 */

function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Tải ảnh lên kho lưu trữ thất bại (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Tải ảnh thất bại, vui lòng thử lại."));
    xhr.send(file);
  });
}

export default function VenuePhotoManager({
  venueId,
  venueSlug,
  venueName,
  primarySportSlug,
  storedImageUrl,
  uploadsConfigured,
}: {
  venueId: string;
  venueSlug: string;
  venueName: string;
  primarySportSlug: string | null;
  storedImageUrl: string | null;
  uploadsConfigured: boolean;
}) {
  const router = useRouter();
  const [stored, setStored] = useState<string | null>(storedImageUrl);
  const [busy, setBusy] = useState<null | "uploading" | "saving" | "removing">(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const configured = uploadsConfigured && !notConfigured;

  async function onFileSelected(file: File) {
    if (!VENUE_PHOTO_CONTENT_TYPES.includes(file.type)) {
      setError("Chỉ chấp nhận ảnh định dạng JPEG, PNG hoặc WebP.");
      return;
    }
    if (file.size > VENUE_PHOTO_MAX_BYTES) {
      setError("Ảnh tối đa 8 MB — vui lòng chọn ảnh nhỏ hơn.");
      return;
    }
    setError(null);
    setBusy("uploading");
    setProgress(0);
    try {
      const presignRes = await fetch("/api/owner/venue-photo/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, contentType: file.type, size: file.size }),
      });
      const presign = (await presignRes.json().catch(() => null)) as {
        uploadUrl?: string;
        publicUrl?: string;
        error?: string;
        code?: string;
      } | null;
      if (!presignRes.ok || !presign?.uploadUrl || !presign.publicUrl) {
        if (presign?.code === "STORAGE_NOT_CONFIGURED") setNotConfigured(true);
        throw new Error(presign?.error ?? "Không tạo được phiên tải ảnh, vui lòng thử lại.");
      }
      await putWithProgress(presign.uploadUrl, file, setProgress);
      setBusy("saving");
      const res = await fetch("/api/owner/venue-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, photoUrl: presign.publicUrl }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!res.ok) {
        if (data?.code === "STORAGE_NOT_CONFIGURED") setNotConfigured(true);
        throw new Error(data?.error ?? "Không lưu được ảnh, vui lòng thử lại.");
      }
      setStored(presign.publicUrl);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Tải ảnh thất bại, vui lòng thử lại.";
      if (message.includes("STORAGE_NOT_CONFIGURED") || message.includes("chưa được bật")) {
        setNotConfigured(true);
      }
      setError(message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function onRemove() {
    setError(null);
    setBusy("removing");
    try {
      const res = await fetch("/api/owner/venue-photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Không gỡ được ảnh, vui lòng thử lại.");
      setStored(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gỡ được ảnh, vui lòng thử lại.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t pt-3">
      <p className="mb-2 text-sm font-semibold">Ảnh sân</p>
      <div className="relative h-40 w-full max-w-md overflow-hidden rounded-xl bg-slate-100">
        <VenueImage
          key={stored ?? "default"}
          primarySportSlug={primarySportSlug}
          venueSlug={venueSlug}
          venueName={venueName}
          storedImageUrl={stored}
          sizes="400px"
        />
      </div>
      <p className="mt-2 text-sm text-slate-500">
        {stored
          ? "Đang hiển thị ảnh đã lưu trong kho lưu trữ của SportsHub."
          : "Đang hiển thị ảnh mặc định theo môn thể thao."}
      </p>
      {configured ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="btn-primary cursor-pointer !px-3 !py-1.5 text-sm">
            {busy === "uploading"
              ? `Đang tải lên… ${progress ?? 0}%`
              : busy === "saving"
                ? "Đang lưu…"
                : stored
                  ? "Thay ảnh khác"
                  : "Tải ảnh lên"}
            <input
              type="file"
              accept={VENUE_PHOTO_CONTENT_TYPES.join(",")}
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onFileSelected(file);
              }}
            />
          </label>
          {stored && (
            <button
              type="button"
              onClick={() => void onRemove()}
              disabled={busy !== null}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === "removing" ? "Đang gỡ…" : "Dùng ảnh mặc định"}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 max-w-md rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Chưa bật kho lưu trữ ảnh — tính năng tải ảnh sân sẽ khả dụng sau khi quản trị kết nối
          Cloudflare R2 cho SportsHub.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
