// ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด (JPEG) ให้ต่ำกว่าลิมิต 1 MB ของเซิร์ฟเวอร์
export function compressImage(file, maxSize = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();

    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // PNG โปร่งใสให้พื้นขาว
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('เปิดไฟล์รูปไม่ได้ กรุณาใช้ไฟล์ JPG, PNG หรือ WebP'));
    };

    img.src = url;
  });
}
