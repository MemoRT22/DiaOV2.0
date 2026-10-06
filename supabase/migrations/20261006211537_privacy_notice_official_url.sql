-- Configuración de la edición: el Aviso de Privacidad oficial de Anáhuac Cancún es la única fuente del enlace que ve el
-- participante (EditionProvider → privacy_notice_url). No agrega campos ni documentos nuevos.
UPDATE public.editions
SET privacy_notice_url = 'https://www.anahuac.mx/cancun/aviso-de-privacidad'
WHERE privacy_notice_url IS DISTINCT FROM 'https://www.anahuac.mx/cancun/aviso-de-privacidad';
