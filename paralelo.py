import requests
import time
import logging
 
# Configurar un logger para este módulo
log = logging.getLogger(__name__)

# --- Sistema de Caché ---
_cached_price = None
_last_fetch_time = 0
CACHE_DURATION_SECONDS = 4 * 60 * 60  # 4 horas
 
def obtener_tasa_cambiar_saldo_ar():
    """
    Obtiene la tasa del USDT en Binance P2P para VES con Mercantil o PagoMovil.
    Filtra por un monto de transacción razonable para obtener una tasa más realista.
    Esta tasa se considera una buena aproximación del dólar paralelo.
    Utiliza un sistema de caché para no consultar la API en cada llamada.
    """
    global _cached_price, _last_fetch_time

    current_time = time.time()

    # 1. Comprobar si la caché es válida
    if _cached_price is not None and (current_time - _last_fetch_time) < CACHE_DURATION_SECONDS:
        log.info(f"Usando tasa de la caché: {_cached_price}")
        return _cached_price

    # 2. Si la caché ha expirado o no existe, obtener un nuevo valor
    log.info("Caché expirada o no existente. Obteniendo nueva tasa de Binance...")
    
    URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
    headers = {
        "Content-Type": "application/json",
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    payload = {
        "fiat": "VES",
        "page": 1,
        "rows": 10, # obtener varias ofertas para calcular una media/top
        "tradeType": "SELL",
        "asset": "USDT",
        "countries": [],
        "proMerchantAds": False,      # Incluir a todos los comerciantes
        "shieldMerchantAds": False,   # Incluir a todos los comerciantes
        "payTypes": ["Mercantil", "PagoMovil"], # Filtramos por el método de pago
        "classifies": ["mass", "profession"],
        "transAmount": "30000" # Filtra por anuncios que acepten una transacción de 30,000 Bs
    }
    
    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(URL, headers=headers, json=payload, timeout=15)
            response.raise_for_status()
            data = response.json()
 
            if data.get('code') == '000000' and data.get('data'):
                ads = data['data']
                prices = []
                for ad in ads:
                    try:
                        price_str = ad['adv']['price']
                        prices.append(float(price_str))
                    except Exception:
                        continue

                if len(prices) == 0:
                    log.warning('No se encontraron precios válidos en las ofertas devueltas.')
                    break

                # Take top 3 lowest prices (best sellers) and average them
                prices_sorted = sorted(prices)
                top3 = prices_sorted[:3]
                avg = sum(top3) / len(top3)

                # 3. Actualizar la caché con el nuevo valor
                _cached_price = avg
                _last_fetch_time = current_time
                log.info(f"Caché actualizada. Nueva tasa (promedio top3): {avg}")

                return avg
            else:
                log.warning(f"La API de Binance no devolvió datos válidos. Respuesta: {data.get('message', 'Sin mensaje')}")
                break # No reintentar si la API responde pero sin datos
        except requests.exceptions.RequestException as e:
            log.warning(f"Intento {attempt + 1}/{MAX_RETRIES} fallido al contactar la API de Binance. Error de red: {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(5)
        except (KeyError, IndexError, ValueError) as e:
            log.error(f"Error procesando la respuesta de Binance: {e}. La estructura de la API pudo haber cambiado.")
            break # No reintentar si la estructura de la API cambió

    # 4. Si la obtención de datos falla, devolver el valor antiguo (si existe) para no romper la app
    log.error("No se pudo obtener una nueva tasa de Binance. Se devolverá el último valor conocido si existe.")
    return _cached_price
 
if __name__ == "__main__":
    # --- Prueba ---
    tasa_saldo_ar = obtener_tasa_cambiar_saldo_ar()
    if tasa_saldo_ar:
        # Print only the numeric value for machine parsing
        print(f"{tasa_saldo_ar:.2f}")
    else:
        print("")
